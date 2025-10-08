// pages/api/cleaner/turns.js
// Returns this cleaner's turns filtered by status.
// Example: /api/cleaner/turns?status=needs_fix,in_progress
//
// Output: { rows: [{ id, status, property_id, property_name, approved_at, needs_fix_at, submitted_at, created_at }] }

import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { parseCleanerSession as _parse } from '@/lib/session';

const supa = typeof _admin === 'function' ? _admin() : _admin;

// Safe wrapper: if parseCleanerSession export shape differs we don't crash
function tryParseCleaner(req) {
  try {
    if (typeof _parse === 'function') return _parse(req);
    // Fallback: look for a JSON cookie named 'turnqa-cleaner'
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)turnqa-cleaner=([^;]+)/);
    if (!m) return null;
    const raw = decodeURIComponent(m[1]);
    try { return JSON.parse(raw); } catch { return null; }
  } catch {
    return null;
  }
}

const ALLOWED = new Set(['needs_fix', 'in_progress', 'submitted', 'approved', 'cancelled']);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ---- identify cleaner from session cookie (normalize all known shapes)
    const sess = tryParseCleaner(req);
    const cleaner_id = sess?.cleaner_id || sess?.sub || sess?.id || null;
    if (!cleaner_id) {
      return res.status(401).json({ error: 'not_authenticated', rows: [] });
    }

    // ---- parse statuses (comma list), normalized + filtered
    const raw = (req.query.status || '').toString();
    const statuses = raw
      .split(',')
      .map(s => s.trim())
      .filter(s => s && ALLOWED.has(s));

    // If nothing valid was supplied, default to the tab use-case
    const wanted = statuses.length ? statuses : ['needs_fix', 'in_progress', 'submitted'];

    // ---- primary shape: turns has cleaner_id and we can join the property name
    let rows = [];
    {
      const select1 =
        'id, status, property_id, approved_at, needs_fix_at, submitted_at, created_at, properties(name)';
      let q = supa
        .from('turns')
        .select(select1)
        .eq('cleaner_id', cleaner_id)
        .in('status', wanted)
        .order('created_at', { ascending: false })
        .limit(50);

      let { data, error } = await q;
      if (!error && Array.isArray(data)) {
        rows = data.map(r => ({
          id: r.id,
          status: r.status,
          property_id: r.property_id,
          property_name: r.properties?.name || r.property_name || null,
          approved_at: r.approved_at || null,
          needs_fix_at: r.needs_fix_at || null,
          submitted_at: r.submitted_at || null,
          created_at: r.created_at || null,
        }));
      } else if (error) {
        // eslint-disable-next-line no-console
        console.warn('[cleaner/turns] primary select failed -> trying fallback', error.message);
      }
    }

    // ---- fallback: join via property_cleaners if turns lacks cleaner_id
    if (rows.length === 0) {
      const select2 =
        'turns!inner(id, status, property_id, approved_at, needs_fix_at, submitted_at, created_at), properties(name)';
      const { data: d2, error: e2 } = await supa
        .from('property_cleaners')
        .select(select2)
        .eq('cleaner_id', cleaner_id)
        .in('turns.status', wanted)
        .order('turns.created_at', { ascending: false })
        .limit(50);

      if (e2) {
        // eslint-disable-next-line no-console
        console.error('[cleaner/turns] fallback select failed', e2.message);
        return res.status(200).json({ rows: [], error: 'no_results' });
      }

      rows = (d2 || []).map(r => {
        const t = r.turns || {};
        return {
          id: t.id,
          status: t.status,
          property_id: t.property_id,
          property_name: r.properties?.name || null,
          approved_at: t.approved_at || null,
          needs_fix_at: t.needs_fix_at || null,
          submitted_at: t.submitted_at || null,
          created_at: t.created_at || null,
        };
      }).filter(x => x.id);
    }

    return res.status(200).json({ rows });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[cleaner/turns] unexpected', e);
    return res.status(200).json({ rows: [], error: 'unexpected' });
  }
}
