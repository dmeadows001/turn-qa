// lib/requireActiveSubscription.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabase } from '@/lib/supabaseServer';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

type Thenable<T> = {
  then: (
    onfulfilled?: (value: T) => any,
    onrejected?: (reason: any) => any
  ) => any;
};

// Works whether supabaseAdmin exports an instance or a factory
const admin = typeof _admin === 'function' ? _admin() : _admin;

function withTimeout<T>(
  p: Thenable<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    Promise.resolve(p as any) as Promise<T>,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout after ${ms}ms at ${label}`)),
        ms
      )
    ),
  ]);
}

type ProfileRow = {
  id: string;
  subscription_status: string | null;
  active_until: string | null;
  trial_ends_at: string | null;
};

function isFutureIso(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

// Match the access rules used by /api/billing/status.
function isActiveProfile(profile: ProfileRow | null): boolean {
  if (!profile) return false;

  const status = String(
    profile.subscription_status || ''
  ).toLowerCase();

  const hardDeny = new Set([
    'canceled',
    'cancelled',
    'incomplete',
    'incomplete_expired',
    'unpaid',
    'past_due',
  ]);

  // A restricted subscription must never be reactivated
  // solely because active_until contains a future date.
  if (hardDeny.has(status)) {
    return false;
  }

  // Active subscriptions remain valid, including those
  // scheduled to cancel at the end of the billing period.
  if (status === 'active') {
    return true;
  }

  // Trial access requires a valid future expiration date.
  if (status === 'trial' || status === 'trialing') {
    return (
      isFutureIso(profile.trial_ends_at) ||
      isFutureIso(profile.active_until)
    );
  }

  // Preserve the existing fallback for profiles with a
  // valid access period and no explicitly denied status.
  if (isFutureIso(profile.active_until)) {
    return true;
  }

  return false;
}

function getBearerToken(req: NextApiRequest) {
  const h = (
    req.headers.authorization ||
    req.headers.Authorization ||
    ''
  ) as string;

  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function requireActiveSubscription(
  req: NextApiRequest,
  res: NextApiResponse,
  opts?: { allowIfMissingProfile?: boolean }
) {
  const t0 = Date.now();

  try {
    console.log('[billing gate] start', { path: req.url });

    // 1) Try cookie-bound authentication first.
    let userId: string | null = null;
    let authMode: 'cookie' | 'bearer' | 'none' = 'none';

    const supabase = createServerSupabase(req, res);

    const userResp = await withTimeout(
      supabase.auth.getUser(),
      8000,
      'supabase.auth.getUser()'
    );

    const {
      data: { user: cookieUser },
      error: uErr,
    } = userResp;

    console.log('[billing gate] gotUser', {
      ms: Date.now() - t0,
      hasUser: !!cookieUser,
      uErr: uErr?.message,
    });

    if (uErr) {
      const msg = uErr?.message || '';
      const canFallback = /auth session missing/i.test(msg);

      if (!canFallback) {
        res.status(500).json({ error: msg || 'Auth error' });

        return {
          ok: false as const,
          handled: true as const,
          error: uErr,
        };
      }
    }

    if (cookieUser?.id) {
      userId = cookieUser.id;
      authMode = 'cookie';
    }

    // 2) Fallback to Bearer token authentication.
    if (!userId) {
      const token = getBearerToken(req);

      if (token) {
        const bearerResp = await withTimeout(
          admin.auth.getUser(token) as any,
          8000,
          'admin.auth.getUser(bearer)'
        );

        const bearerUser =
          (bearerResp as any)?.data?.user || null;

        const bearerErr =
          (bearerResp as any)?.error || null;

        console.log('[billing gate] gotBearerUser', {
          ms: Date.now() - t0,
          hasUser: !!bearerUser,
          bErr: bearerErr?.message,
        });

        if (bearerErr) {
          res.status(401).json({
            error: bearerErr.message || 'Invalid/expired token',
          });

          return {
            ok: false as const,
            handled: true as const,
            error: bearerErr,
          };
        }

        if (bearerUser?.id) {
          userId = bearerUser.id;
          authMode = 'bearer';
        }
      }
    }

    if (!userId) {
      res.status(401).json({ error: 'Not signed in' });

      return {
        ok: false as const,
        handled: true as const,
      };
    }

    // 3) Load the subscription profile using the admin client.
    const profileResp = await withTimeout(
      admin
        .from('profiles')
        .select(
          'id, subscription_status, active_until, trial_ends_at'
        )
        .eq('id', userId)
        .maybeSingle(),
      8000,
      'profiles select'
    );

    const { data: profile, error: pErr } = profileResp as any;

    console.log('[billing gate] gotProfile', {
      ms: Date.now() - t0,
      authMode,
      hasProfile: !!profile,
      pErr: pErr?.message,
    });

    if (pErr) {
      res.status(500).json({
        error: pErr.message || 'Could not load profile',
      });

      return {
        ok: false as const,
        handled: true as const,
      };
    }

    if (!profile) {
      if (opts?.allowIfMissingProfile) {
        // Preserve the existing caller contract.
        return {
          ok: true as const,
          handled: false as const,
          user: { id: userId } as any,
          profile: null,
        };
      }

      res.status(403).json({
        error: 'Profile missing. Please refresh and try again.',
      });

      return {
        ok: false as const,
        handled: true as const,
      };
    }

    // 4) Enforce subscription access.
    if (!isActiveProfile(profile as ProfileRow)) {
      console.log('[billing gate] subscription denied', {
        ms: Date.now() - t0,
        authMode,
        status: profile.subscription_status,
      });

      res.status(402).json({
        error: 'Subscription required',
        subscription_status: profile.subscription_status,
        active_until: profile.active_until,
        trial_ends_at: profile.trial_ends_at,
      });

      return {
        ok: false as const,
        handled: true as const,
      };
    }

    console.log('[billing gate] allowed', {
      ms: Date.now() - t0,
      authMode,
    });

    // Preserve the existing return shape.
    return {
      ok: true as const,
      handled: false as const,
      user: { id: userId } as any,
      profile,
    };
  } catch (e: any) {
    console.error('[billing gate] FAIL', e?.message || e);

    // Do not allow a failed check to hang or grant access.
    res.status(504).json({
      error: e?.message || 'Billing gate timeout',
    });

    return {
      ok: false as const,
      handled: true as const,
    };
  }
}
