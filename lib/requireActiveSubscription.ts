// lib/requireActiveSubscription.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabase } from '@/lib/supabaseServer';

type ProfileRow = {
  id: string;
  subscription_status: string | null;
  active_until: string | null;
  trial_ends_at: string | null;
};

function isActiveProfile(p: ProfileRow | null) {
  if (!p) return false;

  // Paid wins
  if (p.subscription_status === 'active') return true;

  // Trial (or any active window) via active_until
  if (p.active_until) {
    const t = Date.parse(p.active_until);
    if (!Number.isNaN(t) && t > Date.now()) return true;
  }

  return false;
}

export async function requireActiveSubscription(
  req: NextApiRequest,
  res: NextApiResponse,
  opts?: { allowIfMissingProfile?: boolean }
) {
  const supabase = createServerSupabase(req, res);

  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr) {
    return { ok: false as const, handled: true as const, error: uErr };
  }
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return { ok: false as const, handled: true as const };
  }

  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('id, subscription_status, active_until, trial_ends_at')
    .eq('id', user.id)
    .maybeSingle();

  if (pErr) {
    res.status(500).json({ error: pErr.message || 'Could not load profile' });
    return { ok: false as const, handled: true as const };
  }

  if (!profile) {
    if (opts?.allowIfMissingProfile) {
      return { ok: true as const, handled: false as const, user, profile: null };
    }
    // Usually means ensure-profile wasn't called yet
    res.status(403).json({ error: 'Profile missing. Please refresh and try again.' });
    return { ok: false as const, handled: true as const };
  }

  if (!isActiveProfile(profile as any)) {
    // 402 makes it crystal clear: you need to pay to proceed
    res.status(402).json({
      error: 'Subscription required',
      subscription_status: profile.subscription_status,
      active_until: profile.active_until,
      trial_ends_at: profile.trial_ends_at,
    });
    return { ok: false as const, handled: true as const };
  }

  return { ok: true as const, handled: false as const, user, profile };
}
