// pages/api/billing/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabase } from '@/lib/supabaseServer';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const admin = typeof _admin === 'function' ? _admin() : _admin;

function getBearerToken(req: NextApiRequest) {
  const h = (req.headers.authorization || '').trim();
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function isAllowed(profile: any) {
  if (!profile) return false;
  if (profile.subscription_status === 'active') return true;

  if (profile.active_until) {
    const t = Date.parse(profile.active_until);
    if (!Number.isNaN(t) && t > Date.now()) return true;
  }
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1) Prefer Authorization: Bearer <jwt> (works with your localStorage-based session)
  const token = getBearerToken(req);

  let userId: string | null = null;

  if (token) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Not signed in' });
    userId = data.user.id;
  } else {
    // 2) Fallback: cookie-based auth (works if SB cookies exist)
    const supabase = createServerSupabase(req, res);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    userId = user.id;
  }

  // Read profile via service role so this works regardless of RLS
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
