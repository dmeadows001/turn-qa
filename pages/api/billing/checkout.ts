// pages/api/billing/checkout.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createServerSupabase } from '@/lib/supabaseServer';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Method guard
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Config guards (fail fast with clear messages)
  if (!process.env.STRIPE_PRICE_ID) {
    return res.status(500).json({ error: 'Missing STRIPE_PRICE_ID' });
  }
  if (!process.env.NEXT_PUBLIC_BASE_URL) {
    return res.status(500).json({ error: 'Missing NEXT_PUBLIC_BASE_URL' });
  }

  try {
    // Auth: must be signed in
    const supabase = createServerSupabase(req, res);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      return res.status(401).json({ error: 'Please sign in to start checkout.' });
    }

    // Create Stripe Checkout session (subscription)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      customer_email: user.email, // MVP: use email; later upgrade to stored customer id
      allow_promotion_codes: true,
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/managers/turns?billing=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/billing?canceled=1`,
    });

    if (!session?.url) {
      return res.status(500).json({ error: 'Stripe did not return a checkout URL.' });
    }

    return res.status(200).json({ url: session.url });
  } catch (err: any) {
    console.error('checkout error', err);
    // Surface a readable error to the client
    return res.status(500).json({ error: err?.message || 'Checkout session error' });
  }
}
