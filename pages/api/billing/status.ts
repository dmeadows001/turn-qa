// pages/api/billing/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createServerSupabase } from '@/lib/supabaseServer';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const admin = typeof _admin === 'function' ? _admin() : _admin;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

function getBearerToken(req: NextApiRequest) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function isFutureIso(iso: string | null | undefined) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t > Date.now();
}

function isAllowed(profile: any) {
  if (!profile) return false;

  const status = String(profile.subscription_status || '').toLowerCase();

  const hardDeny = new Set([
    'canceled',
    'cancelled',
    'incomplete',
    'incomplete_expired',
    'unpaid',
    'past_due',
  ]);

  if (hardDeny.has(status)) return false;
  if (status === 'active') return true;

  if (status === 'trial' || status === 'trialing') {
    return isFutureIso(profile.trial_ends_at) ||
      isFutureIso(profile.active_until);
  }

  if (isFutureIso(profile.active_until)) return true;

  return false;
}

function isoFromUnix(value?: number | null) {
  return value ? new Date(value * 1000).toISOString() : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const token = getBearerToken(req);
    let userId: string | null = null;

    if (token) {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data?.user) {
        return res.status(401).json({ error: 'Not signed in' });
      }
      userId = data.user.id;
    } else {
      const supabase = createServerSupabase(req, res);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return res.status(401).json({ error: 'Not signed in' });
      }

      userId = user.id;
    }

    const { data: profile, error } = await admin
      .from('profiles')
      .select(
        'subscription_status, active_until, trial_ends_at, stripe_customer_id'
      )
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;

    const response: any = {
      ok: true,
      allowed: isAllowed(profile),
      subscription_status: profile?.subscription_status || null,
      active_until: profile?.active_until || null,
      trial_ends_at: profile?.trial_ends_at || null,
      plan_name: null,
      price_amount: null,
      currency: null,
      billing_interval: null,
      cancel_at_period_end: false,
      cancel_at: null,
      current_period_end: null,
      next_billing_date: null,
    };

    if (profile?.stripe_customer_id) {
      if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error('Missing STRIPE_SECRET_KEY');
      }

      const subscriptions = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: 'all',
        limit: 100,
      });

      const candidates = subscriptions.data.filter(
        (sub) => sub.status !== 'incomplete_expired'
      );

      const subscription =
        candidates.find((sub) =>
          ['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)
        ) ||
        candidates.find((sub) => sub.status === 'canceled') ||
        null;

      if (subscription) {
        const price = subscription.items.data[0]?.price;
        const product = price?.product;

        let planName = 'TurnQA Pro';

        if (typeof product === 'string') {
          const productDetails = await stripe.products.retrieve(product);
          planName = productDetails.name || planName;
        } else if (product && !('deleted' in product)) {
          planName = product.name || planName;
        }

        const periodEnd = isoFromUnix(subscription.current_period_end);
        const cancellationDate = isoFromUnix(subscription.cancel_at);

        response.subscription_status = subscription.status;
        response.plan_name = planName;
        response.price_amount =
          price?.unit_amount != null ? price.unit_amount / 100 : null;
        response.currency = price?.currency?.toUpperCase() || null;
        response.billing_interval = price?.recurring?.interval || null;
        response.cancel_at_period_end = subscription.cancel_at_period_end;
        response.cancel_at = cancellationDate;
        response.current_period_end = periodEnd;

        response.next_billing_date =
          subscription.cancel_at_period_end || subscription.cancel_at
            ? null
            : periodEnd;

        // Preserve the existing access decision.
        // Subscription access continues to be controlled by
        // the profile and the existing isAllowed() function.
      }
    }

    res.setHeader('Cache-Control', 'no-store');

    return res.status(200).json(response);
  } catch (err: any) {
    console.error('[billing/status]', err?.message || err);

    return res.status(500).json({
      error: 'Unable to retrieve subscription information.',
    });
  }
}
