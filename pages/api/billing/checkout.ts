// pages/api/billing/checkout.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createServerSupabase } from '@/lib/supabaseServer';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Works whether supabaseAdmin exports an instance or a factory
const supaAdmin = typeof _admin === 'function' ? _admin() : _admin;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

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
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Accepts EITHER:
 *  1) cookie-based auth (createServerSupabase bound to req/res cookies)
 *  2) Authorization: Bearer <access_token>
 */
async function getUserFromRequest(req: NextApiRequest, res: NextApiResponse) {
  // 1) Cookie-based session
  try {
    const supaCookie = createServerSupabase(req, res);
    const { data, error } = await supaCookie.auth.getUser();
    if (!error && data?.user) return { user: data.user, authSource: 'cookie' as const };
  } catch {
    // ignore
  }

  // 2) Bearer token
  const token = getBearerToken(req);
  if (token) {
    const { data, error } = await supaAdmin.auth.getUser(token);
    if (!error && data?.user) return { user: data.user, authSource: 'bearer' as const };
  }

  return { user: null, authSource: 'none' as const };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_PRICE_ID) return res.status(500).json({ error: 'Missing STRIPE_PRICE_ID' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });

  try {
    const { user, authSource } = await getUserFromRequest(req, res);

    if (!user?.id || !user?.email) {
      return res.status(401).json({
        error: 'Please sign in to start checkout.',
        authSource,
      });
    }

    // Get existing stripe_customer_id (if any)
    const { data: profile, error: pErr } = await supaAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();

    if (pErr) return res.status(500).json({ error: pErr.message });

    let customerId = profile?.stripe_customer_id || null;

    // Create Stripe customer if missing
    if (!customerId) {
      const cust = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = cust.id;

      const { error: uErr } = await supaAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);

      if (uErr) return res.status(500).json({ error: uErr.message });
    }

    const base = siteBase();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${base}/managers/turns?billing=success`,
      cancel_url: `${base}/billing?canceled=1`,
    });

    if (!session?.url) return res.status(500).json({ error: 'Stripe did not return a checkout URL.' });

    return res.status(200).json({ url: session.url });
  } catch (err: any) {
    console.error('checkout error', err);
    return res.status(500).json({ error: err?.message || 'Checkout session error' });
  }
}
