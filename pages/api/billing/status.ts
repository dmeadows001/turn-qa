// pages/api/billing/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabase } from '@/lib/supabaseServer';

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

  const supabase = createServerSupabase(req, res);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  const { data: profile, error } = await supabase
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
