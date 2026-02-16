// pages/api/billing/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

export const config = {
  api: {
    bodyParser: false, // IMPORTANT: Stripe needs the raw body to verify signatures
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

// IMPORTANT: supabaseAdmin is a factory function in this repo
const supa = typeof _admin === 'function' ? _admin() : _admin;

// ---- helpers ----
async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
    typeof item?.price?.product === 'string' ? item.price.product : item?.price?.product?.id || null;
  return { priceId, productId };
}

// Safe profile update (won’t brick webhook if optional columns don’t exist yet)
async function updateProfileSafe(userId: string, patch: Record<string, any>) {
  const { error } = await supa.from('profiles').update(patch).eq('id', userId);
  if (!error) return;

  const msg = error.message || '';
  // If your DB doesn't have plan columns yet, retry without them.
  if (/column .* does not exist/i.test(msg)) {
    const retryPatch = { ...patch };
    delete retryPatch.plan;
    delete retryPatch.stripe_price_id;
    delete retryPatch.stripe_product_id;
    const r2 = await supa.from('profiles').update(retryPatch).eq('id', userId);
    if (r2.error) throw r2.error;
    return;
  }

  throw error;
}

// Try to find the user profile by stripe_customer_id
async function findUserIdByCustomerId(customerId: string): Promise<string | null> {
  const { data, error } = await supa
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (error) throw error;
  return data?.id || null;
}

// Main “apply subscription → profile” function
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

  // Stripe gives unix seconds for these
  const activeUntil = toIsoFromUnixSeconds(sub.current_period_end);
  const trialEndsAt = toIsoFromUnixSeconds(sub.trial_end);

  const { priceId, productId } = pickPlanFromSubscription(sub);

  // "plan" is optional; we store a stable key (priceId) so you can map it to tiers later.
  const patch: Record<string, any> = {
    subscription_status: status,
    active_until: activeUntil,
    trial_ends_at: trialEndsAt,

    // helpful for customer portal / debugging
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,

    // plan info (safe even if columns don't exist: we retry without them)
    stripe_price_id: priceId,
    stripe_product_id: productId,
    plan: priceId, // simplest plan key; you can later map priceId -> "Starter/Growth/etc"
  };

  await updateProfileSafe(userId, patch);

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
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  if (!process.env.STRIPE_WEBHOOK_SECRET)
    return res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET' });

  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') return res.status(400).json({ error: 'Missing stripe-signature' });

  let event: Stripe.Event;

  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('[stripe webhook] signature verify failed', err?.message || err);
    return res.status(400).json({ error: `Webhook Error: ${err?.message || 'bad signature'}` });
  }

  try {
    // Keep the webhook focused: we only need subscription truth.
    switch (event.type) {
      case 'checkout.session.completed': {
        // Often fires before subscription.* events. We can optionally link customer -> profile here.
        // But your checkout already writes stripe_customer_id into profiles, so this is best-effort only.
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

      // Optional: if you want to aggressively revoke access on failed payment
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = String(inv.customer || '');
        console.log('[stripe webhook] invoice.payment_failed', { invoice: inv.id, customerId });

        // You can choose to set subscription_status only; Stripe will also send subscription.updated anyway.
        // We'll just acknowledge.
        break;
      }

      default:
        // Acknowledge everything, don’t error.
        // Stripe retries on non-2xx, so we keep webhook resilient.
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error('[stripe webhook] handler failed', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Webhook handler failed' });
  }
}
