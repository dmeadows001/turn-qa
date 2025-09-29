import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createServerSupabase } from '@/lib/supabaseServer';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  // attach a customer id in metadata or map via profiles table if you store it
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    customer_email: user.email || undefined,
    success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/billing?success=1`,
    cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/billing?canceled=1`,
  });

  return res.status(200).json({ url: session.url });
}
