// pages/api/billing/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabase } from '@/lib/supabaseServer';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const admin = typeof _admin === 'function' ? _admin() : _admin;

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

  // 🔒 Hard-deny states (your desired behavior)
  // If Stripe says canceled / incomplete / unpaid etc → not allowed, even if active_until is in the future.
  const hardDeny = new Set([
    'canceled',
    'cancelled',
    'incomplete',
    'incomplete_expired',
    'unpaid',
    'past_due',
  ]);
  if (hardDeny.has(status)) return false;

  // ✅ Active always allowed
  if (status === 'active') return true;

  // ✅ Trial allowed only while trial_ends_at is still in the future
  if (status === 'trial' || status === 'trialing') {
    return isFutureIso(profile.trial_ends_at) || isFutureIso(profile.active_until);
  }

  // ✅ Fallback: if you have a legacy “active_until” window, respect it
  // (but only if status is NOT one of the hard-deny statuses above)
  if (isFutureIso(profile.active_until)) return true;

  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ✅ Prefer Bearer token (works with localStorage sessions)
  const token = getBearerToken(req);
  let userId: string | null = null;

  if (token) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Not signed in' });
    userId = data.user.id;
  } else {
    // fallback: cookie-based session
    const supabase = createServerSupabase(req, res);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    userId = user.id;
  }

  const { data: profile, error } = await admin
    .from('profiles')
    .select('subscription_status, active_until, trial_ends_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    ok: true,
    allowed: isAllowed(profile),
    subscription_status: profile?.subscription_status || null,
    active_until: profile?.active_until || null,
    trial_ends_at: profile?.trial_ends_at || null,
  });
}
