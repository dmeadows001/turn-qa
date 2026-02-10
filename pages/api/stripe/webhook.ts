// pages/api/stripe/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

function getCustomerIdFromSubscription(sub: Stripe.Subscription): string | null {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  return customerId ? String(customerId) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sig = req.headers['stripe-signature'] as string;

  // Read raw body for Stripe signature verification
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Use an admin client instance
  const supa = supabaseAdmin();

  // Handle events
  if (event.type === 'checkout.session.completed') {
    return res.json({ ok: true });
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const sub = event.data.object as Stripe.Subscription;
    const currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();

+    const customerId = getCustomerIdFromSubscription(sub);
+    if (!customerId) return res.json({ ok: true });

    const { data: profile } = await supa
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (profile) {
      await supa
        .from('profiles')
        .update({
          subscription_status: sub.status === 'active' ? 'active' : (sub.status as any),
          active_until: currentPeriodEnd
        })
        .eq('id', profile.id);
    }

    return res.json({ ok: true });
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;

    const customerId = getCustomerIdFromSubscription(sub);
    if (!customerId) return res.json({ ok: true });

    const { data: profile } = await supa
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (profile) {
      await supa
        .from('profiles')
        .update({ subscription_status: 'canceled' })
        .eq('id', profile.id);
    }

    return res.json({ ok: true });
  }

  // Unhandled event types
  return res.json({ ok: true });
}
