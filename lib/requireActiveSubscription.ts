// lib/requireActiveSubscription.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabase } from '@/lib/supabaseServer';

type Thenable<T> = { then: (onfulfilled?: (value: T) => any, onrejected?: (reason: any) => any) => any };

function withTimeout<T>(p: Thenable<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p as any) as Promise<T>, // wraps thenables/builders into a real Promise
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms at ${label}`)), ms)
    ),
  ]);
}

type ProfileRow = {
  id: string;
  subscription_status: string | null;
  active_until: string | null;
  trial_ends_at: string | null;
};

function isActiveProfile(p: ProfileRow | null) {
  if (!p) return false;
  if (p.subscription_status === 'active') return true;
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
  const t0 = Date.now();
  try {
    console.log('[billing gate] start', { path: req.url });

    const supabase = createServerSupabase(req, res);

    const userResp = await withTimeout(
      supabase.auth.getUser(),
      8000,
      'supabase.auth.getUser()'
    );

    const { data: { user }, error: uErr } = userResp;

    console.log('[billing gate] gotUser', { ms: Date.now() - t0, hasUser: !!user, uErr: uErr?.message });

    if (uErr) {
      res.status(500).json({ error: uErr.message || 'Auth error' });
      return { ok: false as const, handled: true as const, error: uErr };
    }

    if (!user) {
      res.status(401).json({ error: 'Not signed in' });
      return { ok: false as const, handled: true as const };
    }

    const profileResp = await withTimeout(
      supabase
        .from('profiles')
        .select('id, subscription_status, active_until, trial_ends_at')
        .eq('id', user.id)
        .maybeSingle(),
      8000,
      'profiles select'
    );

    const { data: profile, error: pErr } = profileResp;

    console.log('[billing gate] gotProfile', { ms: Date.now() - t0, hasProfile: !!profile, pErr: pErr?.message });

    if (pErr) {
      res.status(500).json({ error: pErr.message || 'Could not load profile' });
      return { ok: false as const, handled: true as const };
    }

    if (!profile) {
      if (opts?.allowIfMissingProfile) {
        return { ok: true as const, handled: false as const, user, profile: null };
      }
      res.status(403).json({ error: 'Profile missing. Please refresh and try again.' });
      return { ok: false as const, handled: true as const };
    }

    if (!isActiveProfile(profile as any)) {
      res.status(402).json({
        error: 'Subscription required',
        subscription_status: profile.subscription_status,
        active_until: profile.active_until,
        trial_ends_at: profile.trial_ends_at,
      });
      return { ok: false as const, handled: true as const };
    }

    console.log('[billing gate] allowed', { ms: Date.now() - t0 });

    return { ok: true as const, handled: false as const, user, profile };
  } catch (e: any) {
    console.error('[billing gate] FAIL', e?.message || e);
    // critical: do NOT let it hang; respond
    res.status(504).json({ error: e?.message || 'Billing gate timeout' });
    return { ok: false as const, handled: true as const };
  }
}
