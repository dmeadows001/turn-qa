// pages/api/billing/checkout.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createServerSupabase } from '@/lib/supabaseServer';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

// Works whether supabaseAdmin exports an instance or a factory
const supaAdmin = typeof _admin === 'function' ? _admin() : _admin;

function siteBase() {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'https://www.turnqa.com'
  ).replace(/\/+$/, '');
}

function getBearerToken(req: NextApiRequest) {
  const h = (req.headers.authorization || '').trim();
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Accepts either STRIPE_PRICE_ID = price_... OR prod_...
async function resolvePriceId(idFromEnv: string) {
  const raw = (idFromEnv || '').trim();
  if (!raw) throw new Error('Missing STRIPE_PRICE_ID');

  // Normal case
  if (raw.startsWith('price_')) return raw;

  // If user accidentally configured a Product ID, convert to its default price
  if (raw.startsWith('prod_')) {
    const product = await stripe.products.retrieve(raw);
    const dp: any = product.default_price;

    const priceId =
      typeof dp === 'string'
        ? dp
        : (dp && typeof dp === 'object' && typeof dp.id === 'string')
          ? dp.id
          : null;

    if (!priceId || !String(priceId).startsWith('price_')) {
      throw new Error(
        `STRIPE_PRICE_ID is a Product (${raw}) but it has no usable default_price. In Stripe, set a default price for the product or use a price_... id.`
      );
    }
    return priceId;
  }

  throw new Error(
    `STRIPE_PRICE_ID must start with price_ (recommended) or prod_ (product with default_price). Got: ${raw}`
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  if (!process.env.STRIPE_PRICE_ID) return res.status(500).json({ error: 'Missing STRIPE_PRICE_ID' });

  try {
    // 1) Identify user (cookie session OR Bearer token)
    const supabase = createServerSupabase(req, res);

    let userId: string | null = null;
    let email: string | null = null;

    const cookieResp = await supabase.auth.getUser();
    if (cookieResp?.data?.user?.id) {
      userId = cookieResp.data.user.id;
      email = cookieResp.data.user.email ?? null;
    }

    // If cookie session isn't present, try Authorization: Bearer <jwt>
    if (!userId) {
      const token = getBearerToken(req);
      if (token) {
        const { data, error } = await supaAdmin.auth.getUser(token);
        if (!error && data?.user?.id) {
          userId = data.user.id;
          email = data.user.email ?? null;
        }
      }
    }

    if (!userId || !email) {
      return res.status(401).json({ error: 'Please sign in to start checkout.' });
    }

    // 2) Ensure we have a Stripe customer id
    const { data: profile, error: pErr } = await supaAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();

    if (pErr) return res.status(500).json({ error: pErr.message || 'Could not load profile' });

    let customerId = profile?.stripe_customer_id || null;

    if (!customerId) {
      const cust = await stripe.customers.create({
        email,
        metadata: { supabase_user_id: userId },
      });
      customerId = cust.id;

      const { error: uErr } = await supaAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);

      if (uErr) return res.status(500).json({ error: uErr.message || 'Could not update profile' });
    }

    // 3) Resolve price id safely (supports prod_ via default_price)
    const priceId = await resolvePriceId(process.env.STRIPE_PRICE_ID!);

    // 4) Create Checkout session
    const base = siteBase();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${base}/managers/turns?billing=success`,
      cancel_url: `${base}/billing?canceled=1`,
    });

    if (!session?.url) return res.status(500).json({ error: 'Stripe did not return a checkout URL.' });
    return res.status(200).json({ url: session.url });
  } catch (err: any) {
    // Make Stripe errors readable
    const msg = err?.message || 'Checkout session error';
    console.error('[billing/checkout] error', msg, err);
    return res.status(500).json({ error: msg });
  }
}
