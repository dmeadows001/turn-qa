// pages/api/billing/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const admin = typeof _admin === 'function' ? _admin() : _admin;

function getBearerToken(req: NextApiRequest) {
  const h = req.headers.authorization || '';
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

  // ✅ Use Bearer auth (your app stores session in localStorage)
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Missing Authorization token' });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const user = userData?.user || null;
  if (userErr || !user) return res.status(401).json({ error: 'Not signed in' });

  const { data: profile, error } = await admin
    .from('profiles')
    .select('subscription_status, active_until, trial_ends_at')
    .eq('id', user.id)
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
