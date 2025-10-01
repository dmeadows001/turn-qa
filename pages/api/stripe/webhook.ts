// pages/api/stripe/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

async function getCustomerEmailFromSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  const cust = await stripe.customers.retrieve(customerId);
  return 'deleted' in cust ? null : (cust.email ?? null);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'] as string;

  const buf = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const sub = event.data.object as Stripe.Subscription;
    const currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
    const email = await getCustomerEmailFromSubscription(sub);
    if (email) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (profile) {
        await supabaseAdmin
          .from('profiles')
          .update({
            subscription_status: sub.status === 'active' ? 'active' : (sub.status as any),
            active_until: currentPeriodEnd,
          })
          .eq('id', profile.id);
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const email = await getCustomerEmailFromSubscription(sub);
    if (email) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (profile) {
        await supabaseAdmin
          .from('profiles')
          .update({ subscription_status: 'canceled' })
          .eq('id', profile.id);
      }
    }
  }

  return res.json({ ok: true });
}
