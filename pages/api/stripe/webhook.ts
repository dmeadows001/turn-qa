// pages/api/stripe/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

export const config = {
  api: { bodyParser: false }, // Stripe requires raw body for signature verification
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

// IMPORTANT: supabaseAdmin is a factory function in this repo
const supa = typeof _admin === 'function' ? _admin() : _admin;

// ---- raw body helper ----
async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function toIsoFromUnixSeconds(sec: number | null | undefined) {
  if (!sec || typeof sec !== 'number') return null;
  return new Date(sec * 1000).toISOString();
}

function getCustomerId(sub: Stripe.Subscription): string | null {
  const c = sub.customer as any;
  if (!c) return null;
  return typeof c === 'string' ? c : (c.id ? String(c.id) : null);
}

// Stripe sometimes has current_period_end at sub.current_period_end,
// and sometimes only inside items.data[0].current_period_end depending on event shape.
function getCurrentPeriodEndSeconds(sub: Stripe.Subscription): number | null {
  const root = (sub as any).current_period_end;
  if (typeof root === 'number') return root;

  const item0 = sub.items?.data?.[0] as any;
  const nested = item0?.current_period_end;
  if (typeof nested === 'number') return nested;

  return null;
}

function pickPlanFromSubscription(sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0] as any;
  const priceId = item?.price?.id || null;

  const productRaw = item?.price?.product;
  const productId =
    typeof productRaw === 'string'
      ? productRaw
      : (productRaw?.id ? productRaw.id : null);

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
    console.warn('[stripe webhook] subscription missing customer');
    return;
  }

  const userId = await findUserIdByCustomerId(customerId);
  if (!userId) {
    console.warn('[stripe webhook] no profile found for customer', customerId);
    return;
  }

  const status = (sub.status || null) as any;

  const cancelAtPeriodEnd = Boolean((sub as any).cancel_at_period_end);

  const periodEndSec = getCurrentPeriodEndSeconds(sub);
  const periodEndIso = toIsoFromUnixSeconds(periodEndSec);

  const endedAtIso = toIsoFromUnixSeconds((sub as any).ended_at);
  const canceledAtIso = toIsoFromUnixSeconds((sub as any).canceled_at);

  const trialEndsAt = toIsoFromUnixSeconds((sub as any).trial_end);

  const { priceId, productId } = pickPlanFromSubscription(sub);

  // ✅ Correct access window rules:
  // - If cancel_at_period_end=true, access continues until current_period_end.
  // - If status=canceled AND cancel_at_period_end=false (immediate cancel), access ends now (ended_at/canceled_at).
  // - Otherwise, use current_period_end when available.
  let finalActiveUntil: string | null = null;

  const isImmediateCancel = status === 'canceled' && cancelAtPeriodEnd === false;

  if (isImmediateCancel) {
    finalActiveUntil = endedAtIso || canceledAtIso || null;
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
    plan: priceId, // stable plan key
  };

  const { error } = await supa.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;

  console.log('[stripe webhook] profile updated', {
    userId,
    customerId,
    subId: sub.id,
    status,
    cancelAtPeriodEnd,
    isImmediateCancel,
    activeUntil: finalActiveUntil,
    trialEndsAt,
    priceId,
    productId,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET' });

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
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await applySubscriptionToProfile(sub);
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
