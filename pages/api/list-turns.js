// pages/api/list-turns.js
import { createClient } from '@supabase/supabase-js';

function isAllowed(profile) {
  if (!profile) return false;
  if (profile.subscription_status === 'active') return true;

  if (profile.active_until) {
    const t = Date.parse(profile.active_until);
    if (!Number.isNaN(t) && t > Date.now()) return true;
  }
  return false;
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = req.headers.authorization || '';
    const hasBearer = auth.toLowerCase().startsWith('bearer ');
    console.log('[list-turns] start', {
      hasBearer,
      hasCookie: !!req.headers.cookie,
      query: req.query,
    });

    if (!hasBearer) {
      return res.status(401).json({ error: 'Missing Authorization token' });
    }

    // Create a user-scoped client (RLS ON) using the Bearer token
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anon) {
      return res.status(500).json({ error: 'Missing SUPABASE env vars (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY)' });
    }

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: auth } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    // ✅ Auth: get user from the Bearer token
    const { data: userResp, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      console.log('[list-turns] auth.getUser error', { message: userErr.message });
      return res.status(401).json({ error: userErr.message || 'Not signed in' });
    }
    const user = userResp?.user;
    if (!user) return res.status(401).json({ error: 'Not signed in' });

    // ✅ Billing gate (RLS-safe)
    console.log('[list-turns] billing check', { userId: user.id });

    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('id, subscription_status, active_until, trial_ends_at')
      .eq('id', user.id)
      .maybeSingle();

    if (pErr) {
      console.log('[list-turns] profile error', { message: pErr.message });
      return res.status(500).json({ error: pErr.message || 'Could not load profile' });
    }

    if (!isAllowed(profile)) {
      return res.status(402).json({
        error: 'Subscription required',
        subscription_status: profile?.subscription_status ?? null,
        active_until: profile?.active_until ?? null,
        trial_ends_at: profile?.trial_ends_at ?? null,
      });
    }

    const { status, from, to, limit: limitParam, property_id } = req.query;

    const requestedLimit = Number(limitParam ?? 200);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 1000)
      : 200;

    const pid = Array.isArray(property_id) ? property_id[0] : property_id;

    console.log('[list-turns] query params', { status, from, to, limit, pid });

    let query = supabase
      .from('manager_turns')
      .select(
        `
        id,
        created_at,
        submitted_at,
        approved_at,
        needs_fix_at,
        status,
        property_id,
        property_name
      `
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (pid) query = query.eq('property_id', String(pid));

    console.log('[list-turns] executing query');
    const { data, error } = await query;

    if (error) {
      console.log('[list-turns] query error', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return res.status(500).json({ error: error.message || 'Query failed' });
    }

    const rows = (data || []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      submitted_at: r.submitted_at,
      approved_at: r.approved_at,
      needs_fix_at: r.needs_fix_at ?? null,
      status: r.status,
      property_id: r.property_id,
      property_name: r.property_name || '(unnamed)',
    }));

    console.log('[list-turns] success', { rows: rows.length, ms: Date.now() - startedAt });
    return res.status(200).json({ rows });
  } catch (e) {
    console.error('[list-turns] fatal', { message: e?.message || String(e), ms: Date.now() - startedAt });
    return res.status(500).json({ error: e?.message || 'unexpected error' });
  }
}
