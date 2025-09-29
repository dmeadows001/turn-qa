import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createServerSupabase } from '@/lib/supabaseServer';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sig = req.headers['stripe-signature'] as string;
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const chunks: any[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const supabase = createServerSupabase();

  // We’ll handle both checkout completion and subscription updates
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session;
    // do nothing yet; next update event will contain subscription periods
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const sub = event.data.object as Stripe.Subscription;
    const currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();

    // Find the user by email (or maintain a stripe_customer_id column in profiles)
    const email = (sub.customer_email as string) || (sub.customer as string); // prefer email if present
    if (!email) return res.json({ ok: true });

    const { data: profile } = await supabase.from('profiles').select('id').eq('email', email).single();
    if (profile) {
      await supabase.from('profiles').update({
        subscription_status: sub.status === 'active' ? 'active' : (sub.status as any),
        active_until: currentPeriodEnd
      }).eq('id', profile.id);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const email = (sub.customer_email as string) || (sub.customer as string);
    const { data: profile } = await supabase.from('profiles').select('id, active_until').eq('email', email).single();
    if (profile) {
      // keep access until already-set active_until; status moves to canceled
      await supabase.from('profiles').update({ subscription_status: 'canceled' }).eq('id', profile.id);
    }
  }

  return res.json({ ok: true });
}
