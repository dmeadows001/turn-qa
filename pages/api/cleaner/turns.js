// pages/api/cleaner/turns.js
// Returns a cleaner's turns with optional status filtering.
// Includes (A) turns started by this cleaner and (B) turns at properties
// the cleaner is assigned to (property_cleaners), so older jobs still appear.

import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { parseCleanerSession } from '@/lib/session'; // must export this; see note below

const supa = typeof _admin === 'function' ? _admin() : _admin;

function parseStatuses(raw = '') {
  if (!raw) return null;
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1) Who is the cleaner? (cookie set by /api/otp/verify)
    const cookie = req.headers.cookie || '';
    const cleaner = parseCleanerSession(cookie); // { cleaner_id, phone }
    if (!cleaner?.cleaner_id) {
      return res.status(401).json({ error: 'not_authenticated' });
    }
    const cleanerId = cleaner.cleaner_id;

    // 2) Status filter
    const statuses = parseStatuses(req.query.status || '');
    // If none provided, default to useful view:
    const wanted = statuses || ['needs_fix', 'in_progress', 'submitted'];

    // 3A) Turns started by this cleaner
    const { data: mine, error: mineErr } = await supa
      .from('turns')
      .select('id, property_id, status, created_at')
      .eq('cleaner_id', cleanerId)
      .in('status', wanted)
      .order('created_at', { ascending: false });
    if (mineErr) throw mineErr;

    // 3B) Properties this cleaner is assigned to
    const { data: assigns, error: aErr } = await supa
      .from('property_cleaners')
      .select('property_id')
      .eq('cleaner_id', cleanerId);
    if (aErr) throw aErr;
    const propIds = (assigns || []).map(a => a.property_id);
    let assignedTurns = [];
    if (propIds.length) {
      const { data, error } = await supa
        .from('turns')
        .select('id, property_id, status, created_at')
        .in('property_id', propIds)
        .in('status', wanted)
        .order('created_at', { ascending: false });
      if (error) throw error;
      assignedTurns = data || [];
    }

    // 4) Merge & de-dupe
    const byId = new Map();
    [...(mine || []), ...assignedTurns].forEach(t => byId.set(t.id, t));
    const rows = Array.from(byId.values());

    // 5) Attach property names (optional but nice)
    const uniqProps = Array.from(new Set(rows.map(r => r.property_id)));
    const nameById = new Map();
    if (uniqProps.length) {
      const { data: props, error: pErr } = await supa
        .from('properties')
        .select('id, name')
        .in('id', uniqProps);
      if (!pErr && props) props.forEach(p => nameById.set(p.id, p.name));
    }
    const withNames = rows.map(r => ({ ...r, property_name: nameById.get(r.property_id) || 'Property' }));

    return res.status(200).json({ rows: withNames });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'cleaner/turns failed' });
  }
}
