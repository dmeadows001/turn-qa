// pages/api/stripe/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

export const config = {
  api: { bodyParser: false }, // Stripe requires the raw request body.
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

// supabaseAdmin may be exported as a factory in this project.
const supa = typeof _admin === 'function' ? _admin() : _admin;

async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toIsoFromUnixSeconds(sec: number | null | undefined): string | null {
  if (!sec || typeof sec !== 'number') return null;
  return new Date(sec * 1000).toISOString();
}

function getCustomerId(sub: Stripe.Subscription): string | null {
  const customer = sub.customer as any;
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id || null;
}

function getInvoiceCustomerId(invoice: Stripe.Invoice): string | null {
  const customer = invoice.customer as any;
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id || null;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // Supports both the 2024-06-20 invoice shape and newer Stripe invoice shapes.
  const direct = (invoice as any).subscription;
  if (typeof direct === 'string') return direct;
  if (direct?.id) return String(direct.id);

  const nested = (invoice as any).parent?.subscription_details?.subscription;
  if (typeof nested === 'string') return nested;
  if (nested?.id) return String(nested.id);

  return null;
}

function getCurrentPeriodEndSeconds(sub: Stripe.Subscription): number | null {
  const root = (sub as any).current_period_end;
  if (typeof root === 'number') return root;

  const item = sub.items?.data?.[0] as any;
  return typeof item?.current_period_end === 'number'
    ? item.current_period_end
    : null;
}

function pickPlanFromSubscription(sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0] as any;
  const priceId = item?.price?.id || null;
  const rawProduct = item?.price?.product;
  const productId =
    typeof rawProduct === 'string' ? rawProduct : rawProduct?.id || null;
  return { priceId, productId };
}

async function findUserIdByCustomerId(customerId: string): Promise<string | null> {
  const { data, error } = await supa
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (error) throw error;
  return data?.id || null;
}

async function applySubscriptionToProfile(sub: Stripe.Subscription) {
  const customerId = getCustomerId(sub);
  if (!customerId) {
    console.warn('[stripe webhook] subscription missing customer', sub.id);
    return;
  }

  const userId = await findUserIdByCustomerId(customerId);
  if (!userId) {
    console.warn('[stripe webhook] no profile found for customer', customerId);
    return;
  }

  const stripeStatus = sub.status;
  const status =
    stripeStatus === 'trialing' ? 'trial' :
    stripeStatus === 'active' ? 'active' :
    stripeStatus === 'canceled' || stripeStatus === 'incomplete_expired' ? 'canceled' :
    'past_due';

  const cancelAtPeriodEnd = Boolean((sub as any).cancel_at_period_end);
  const periodEndIso = toIsoFromUnixSeconds(getCurrentPeriodEndSeconds(sub));
  const endedAtIso = toIsoFromUnixSeconds((sub as any).ended_at);
  const canceledAtIso = toIsoFromUnixSeconds((sub as any).canceled_at);
  const trialEndsAt = toIsoFromUnixSeconds((sub as any).trial_end);
  const { priceId, productId } = pickPlanFromSubscription(sub);

  const isImmediateCancel = status === 'canceled' && !cancelAtPeriodEnd;
  const isPaymentRestricted = status === 'past_due';

  let finalActiveUntil: string | null;
  if (isPaymentRestricted) {
    // The existing manager APIs gate on active_until, not subscription_status.
    finalActiveUntil = new Date().toISOString();
  } else if (isImmediateCancel) {
    finalActiveUntil = endedAtIso || canceledAtIso || new Date().toISOString();
  } else {
    finalActiveUntil = periodEndIso || endedAtIso || canceledAtIso || null;
  }

  const patch: Record<string, any> = {
    subscription_status: status,
    active_until: finalActiveUntil,
    trial_ends_at: trialEndsAt,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    stripe_product_id: productId,
    plan: priceId,
  };

  const { error } = await supa.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;

  console.log('[stripe webhook] profile updated', {
    userId,
    customerId,
    subId: sub.id,
    status,
    cancelAtPeriodEnd,
    activeUntil: finalActiveUntil,
  });
}

async function handleInvoiceEvent(invoice: Stripe.Invoice, failed: boolean) {
  const customerId = getInvoiceCustomerId(invoice);
  const invoiceSubId = getInvoiceSubscriptionId(invoice);

  // Ignore one-off invoices; these handlers only affect recurring subscriptions.
  if (!customerId || !invoiceSubId) {
    console.log('[stripe webhook] invoice missing subscription/customer; skipped', {
      invoiceId: invoice.id,
      failed,
    });
    return;
  }

  const userId = await findUserIdByCustomerId(customerId);
  if (!userId) {
    console.warn('[stripe webhook] invoice customer has no profile', customerId);
    return;
  }

  const { data: profile, error: lookupError } = await supa
    .from('profiles')
    .select('stripe_subscription_id')
    .eq('id', userId)
    .single();
  if (lookupError) throw lookupError;

  if (profile?.stripe_subscription_id !== invoiceSubId) {
    console.log('[stripe webhook] invoice is not for current subscription; skipped', {
      invoiceId: invoice.id,
      invoiceSubId,
      profileSubId: profile?.stripe_subscription_id,
    });
    return;
  }

  // Read live Stripe state, not an event that may be delayed or replayed.
  const [latestInvoice, currentSub] = await Promise.all([
    stripe.invoices.retrieve(invoice.id),
    stripe.subscriptions.retrieve(invoiceSubId),
  ]);

  if (getCustomerId(currentSub) !== customerId) {
    console.warn('[stripe webhook] subscription/customer mismatch', invoice.id);
    return;
  }

  if (failed) {
    // An old failed invoice may already have been paid; never revoke access then.
    if (latestInvoice.status === 'paid') {
      console.log('[stripe webhook] old failed invoice now paid; skipped', invoice.id);
      return;
    }

    if (currentSub.status === 'past_due' || currentSub.status === 'unpaid') {
      await applySubscriptionToProfile(currentSub);
      console.log('[stripe webhook] failed payment; access restricted', invoice.id);
    } else {
      console.log('[stripe webhook] failed invoice; subscription not overdue', {
        invoiceId: invoice.id,
        subscriptionStatus: currentSub.status,
      });
    }
    return;
  }

  // Restore access only when Stripe confirms the invoice is paid and the
  // subscription itself is currently active (or trialing).
  if (
    latestInvoice.status === 'paid' &&
    (currentSub.status === 'active' || currentSub.status === 'trialing')
  ) {
    await applySubscriptionToProfile(currentSub);
    console.log('[stripe webhook] paid invoice; subscription synchronized', invoice.id);
  } else {
    console.log('[stripe webhook] paid event did not qualify for restoration', {
      invoiceId: invoice.id,
      invoiceStatus: latestInvoice.status,
      subscriptionStatus: currentSub.status,
    });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    return res.status(400).json({ error: 'Missing stripe-signature' });
  }

  let event: Stripe.Event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('[stripe webhook] signature verify failed', err?.message || err);
    return res.status(400).json({ error: `Webhook Error: ${err?.message || 'bad signature'}` });
  }

  try {
    switch (event.type) {
      case 'invoice.payment_failed':
        await handleInvoiceEvent(event.data.object as Stripe.Invoice, true);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoiceEvent(event.data.object as Stripe.Invoice, false);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const eventSub = event.data.object as Stripe.Subscription;
        const currentSub = await stripe.subscriptions.retrieve(eventSub.id);
        await applySubscriptionToProfile(currentSub);
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log('[stripe webhook] checkout.session.completed', {
          id: session.id,
          customer: session.customer,
          subscription: session.subscription,
        });
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error('[stripe webhook] handler failed', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Webhook handler failed' });
  }
}
