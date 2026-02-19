// pages/api/ensure-profile.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabase } from '@/lib/supabaseServer';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Works whether supabaseAdmin exports an instance or a factory
const admin = typeof _admin === 'function' ? _admin() : _admin;

function addDaysISO(days: number) {
  const now = new Date();
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function getBearerToken(req: NextApiRequest) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end();
  }

  try {
    // 1) Identify user (Bearer token preferred, cookie fallback)
    let userId: string | null = null;
    let userEmail: string | null = null;

    const bearer = getBearerToken(req);

    if (bearer) {
      const { data, error } = await admin.auth.getUser(bearer);
      if (error || !data?.user) {
        return res.status(401).json({ error: 'Not signed in' });
      }
      userId = data.user.id;
      userEmail = data.user.email ?? null;
    } else {
      const supabase = createServerSupabase(req, res);
      const { data } = await supabase.auth.getUser();
      if (!data?.user) return res.status(401).json({ error: 'Not signed in' });
      userId = data.user.id;
      userEmail = data.user.email ?? null;
    }

    if (!userId) return res.status(401).json({ error: 'Not signed in' });

    const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 30);
    const proposedTrialEnd = addDaysISO(TRIAL_DAYS);

    // 2) Read profile (use admin so RLS can’t block it)
    const { data: existing, error: selErr } = await admin
      .from('profiles')
      .select('id, email, subscription_status, trial_ends_at, active_until')
      .eq('id', userId)
      .maybeSingle();

    if (selErr) return res.status(500).json({ error: selErr.message });

    // 3) If missing, create profile with trial (one-time)
    if (!existing) {
      const { error: insErr } = await admin.from('profiles').insert({
        id: userId,
        email: userEmail,
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

    // 4) If exists, DO NOT extend trial (only backfill legacy rows / normalize)
    const patch: any = {};

    if (!existing.email && userEmail) patch.email = userEmail;

    const hasTrialEnds = !!existing.trial_ends_at;
    const hasActiveUntil = !!existing.active_until;

    // Legacy: if both missing, set once
    if (!hasTrialEnds && !hasActiveUntil) {
      patch.trial_ends_at = proposedTrialEnd;
      patch.active_until = proposedTrialEnd;

      if (!existing.subscription_status || existing.subscription_status === 'trialing') {
        patch.subscription_status = 'trial';
      }
    }

    // Normalize old value "trialing" -> "trial" (no date changes)
    if (existing.subscription_status === 'trialing') {
      patch.subscription_status = 'trial';
    }

    if (Object.keys(patch).length) {
      const { error: upErr } = await admin.from('profiles').update(patch).eq('id', userId);
      if (upErr) return res.status(500).json({ error: upErr.message });
    }

    return res.json({
      ok: true,
      subscription_status: patch.subscription_status || existing.subscription_status || null,
      trial_ends_at: patch.trial_ends_at || existing.trial_ends_at || null,
      active_until: patch.active_until || existing.active_until || null,
      created: false,
    });
  } catch (e: any) {
    console.error('[ensure-profile] error', e);
    return res.status(500).json({ error: e?.message || 'ensure-profile failed' });
  }
}
