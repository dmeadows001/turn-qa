// pages/api/stripe/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

export const config = {
  api: {
    bodyParser: false, // Stripe needs raw body for signature verification
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

// supabaseAdmin is a factory function in this repo
const supa = typeof _admin === 'function' ? _admin() : _admin;

// ---- helpers ----
async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toIsoFromUnixSeconds(sec: number | null | undefined) {
  if (!sec) return null;
  return new Date(sec * 1000).toISOString();
}

function pickPlanFromSubscription(sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id || null;
  const productId =
    typeof item?.price?.product === 'string'
      ? item.price.product
      : item?.price?.product?.id || null;

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
  const customerId = String(sub.customer || '');
  if (!customerId) {
    console.warn('[stripe webhook] subscription missing customer');
    return;
  }

  const userId = await findUserIdByCustomerId(customerId);
  if (!userId) {
    console.warn('[stripe webhook] no profile found for customer', customerId);
    return;
  }

  const status = sub.status || null;
  const activeUntil = toIsoFromUnixSeconds(sub.current_period_end);
  const trialEndsAt = toIsoFromUnixSeconds(sub.trial_end);

  const { priceId, productId } = pickPlanFromSubscription(sub);

  const patch = {
    subscription_status: status,
    active_until: activeUntil,
    trial_ends_at: trialEndsAt,

    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,

    stripe_price_id: priceId,
    stripe_product_id: productId,
    plan: priceId, // stable key; map priceId -> tier later
  };

  const { error } = await supa.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;

  console.log('[stripe webhook] profile updated', {
    userId,
    customerId,
    subId: sub.id,
    status,
    priceId,
    activeUntil,
    trialEndsAt,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handy for curl/browser sanity checks — Stripe will still POST with signature
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.status(200).send('ok');
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST', 'GET', 'HEAD']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET' });

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
      case 'checkout.session.completed': {
        // Not required for your DB sync (subscription events handle truth),
        // but useful for visibility.
        const session = event.data.object as Stripe.Checkout.Session;
        console.log('[stripe webhook] checkout.session.completed', {
          id: session.id,
          customer: session.customer,
          subscription: session.subscription,
        });
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await applySubscriptionToProfile(sub);
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        console.log('[stripe webhook] invoice.payment_failed', {
          invoice: inv.id,
          customer: inv.customer,
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
