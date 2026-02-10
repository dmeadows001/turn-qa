// pages/api/ensure-profile.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabase } from '@/lib/supabaseServer';

function addDaysISO(days: number) {
  const now = new Date();
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = createServerSupabase(req, res);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 30);
  const proposedTrialEnd = addDaysISO(TRIAL_DAYS);

  // 1) Check if profile exists
  const { data: existing, error: selErr } = await supabase
    .from('profiles')
    .select('id, email, subscription_status, trial_ends_at, active_until')
    .eq('id', user.id)
    .maybeSingle();

  if (selErr) return res.status(500).json({ error: selErr.message });

  // 2) If missing, create it with a one-time trial
  if (!existing) {
    const { error: insErr } = await supabase.from('profiles').insert({
      id: user.id,
      email: user.email,
      subscription_status: 'trial',
      trial_ends_at: proposedTrialEnd,
      active_until: proposedTrialEnd,
    });

    if (insErr) return res.status(500).json({ error: insErr.message });

    return res.json({
      ok: true,
      subscription_status: 'trial',
      trial_ends_at: proposedTrialEnd,
      active_until: proposedTrialEnd,
      created: true,
    });
  }

  // 3) If exists, DO NOT extend trial.
  // Only backfill missing fields for older rows.
  const patch: any = {};

  if (!existing.email && user.email) patch.email = user.email;

  const hasTrialEnds = !!existing.trial_ends_at;
  const hasActiveUntil = !!existing.active_until;

  // If both are missing, set them once (legacy rows)
  if (!hasTrialEnds && !hasActiveUntil) {
    patch.trial_ends_at = proposedTrialEnd;
    patch.active_until = proposedTrialEnd;

    // If they’re not already active, set them to trial
    if (!existing.subscription_status || existing.subscription_status === 'trialing') {
      patch.subscription_status = 'trial';
    }
  }

  // Normalize old value "trialing" -> "trial" (no date changes)
  if (existing.subscription_status === 'trialing') {
    patch.subscription_status = 'trial';
  }

  if (Object.keys(patch).length) {
    const { error: upErr } = await supabase.from('profiles').update(patch).eq('id', user.id);
    if (upErr) return res.status(500).json({ error: upErr.message });
  }

  return res.json({
    ok: true,
    subscription_status: patch.subscription_status || existing.subscription_status || null,
    trial_ends_at: patch.trial_ends_at || existing.trial_ends_at || null,
    active_until: patch.active_until || existing.active_until || null,
    created: false,
  });
}
