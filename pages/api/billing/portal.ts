
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createServerSupabase } from '@/lib/supabaseServer';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

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

function getBearerToken(req: NextApiRequest): string | null {
  const header = (req.headers.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({
      error: 'Missing STRIPE_SECRET_KEY',
    });
  }

  try {
    // Authenticate the manager using their existing session.
    const supabase = createServerSupabase(req, res);
    const cookieResponse = await supabase.auth.getUser();

    let userId = cookieResponse.data?.user?.id || null;

    // Support clients using Supabase Bearer tokens.
    if (!userId) {
      const token = getBearerToken(req);

      if (token) {
        const { data, error } = await supaAdmin.auth.getUser(token);

        if (!error && data?.user?.id) {
          userId = data.user.id;
        }
      }
    }

    if (!userId) {
      return res.status(401).json({
        error: 'Please sign in to manage billing.',
      });
    }

    // Look up the Stripe customer linked to this manager.
    const { data: profile, error: profileError } = await supaAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (!profile?.stripe_customer_id) {
      return res.status(400).json({
        error: 'No billing account found. Please start a subscription.',
      });
    }

    // Create a secure, temporary Stripe Customer Portal session.
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteBase()}/billing`,
    });

    if (!session.url) {
      return res.status(500).json({
        error: 'Stripe did not return a billing portal URL.',
      });
    }

    return res.status(200).json({
      url: session.url,
    });
  } catch (err: any) {
    console.error(
      '[billing/portal] error',
      err?.message || err
    );

    return res.status(500).json({
      error: 'Unable to open billing management. Please try again.',
    });
  }
}
