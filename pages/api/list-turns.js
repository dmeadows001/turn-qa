// pages/api/list-turns.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { requireActiveSubscription } from '@/lib/requireActiveSubscription';

// Works whether supabaseAdmin exports an instance or a factory
const supabase = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 🔎 Debug: entry
  console.log('[list-turns] start', {
    query: req.query,
    ua: req.headers['user-agent'],
    hasAuth: !!req.headers.authorization,
    hasCookie: !!req.headers.cookie,
  });

  // 🔒 Billing enforcement
  console.log('[list-turns] billing gate start');
  const gate = await requireActiveSubscription(req, res);
  console.log('[list-turns] billing gate result', {
    ok: gate?.ok,
    handled: gate?.handled,
    userId: gate?.user?.id || null,
    ms: Date.now() - startedAt,
  });

  if (gate.handled) {
    console.log('[list-turns] billing handled — exiting', { ms: Date.now() - startedAt });
    return;
  }

  try {
    const { status, from, to, limit: limitParam, property_id } = req.query;

    const requestedLimit = Number(limitParam ?? 200);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200;

    const pid = Array.isArray(property_id) ? property_id[0] : property_id;

    console.log('[list-turns] params', {
      status: status || null,
      from: from || null,
      to: to || null,
      limit,
      property_id: pid || null,
    });

    // Read from the view (manager_turns) so the shape is already flat
    console.log('[list-turns] building query');
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

    // ✅ property filter (only if provided)
    if (pid) query = query.eq('property_id', String(pid));

    console.log('[list-turns] executing query');
    const { data, error } = await query;
    console.log('[list-turns] query done', {
      ok: !error,
      error: error ? { message: error.message, code: error.code, details: error.details, hint: error.hint } : null,
      count: Array.isArray(data) ? data.length : 0,
      ms: Date.now() - startedAt,
    });

    if (error) throw error;

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
    console.error('[list-turns] fatal', {
      message: e?.message || String(e),
      stack: e?.stack,
      ms: Date.now() - startedAt,
    });
    return res.status(500).json({ error: e?.message || 'unexpected error' });
  }
}
