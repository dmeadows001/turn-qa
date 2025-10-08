// pages/api/cleaner/turns.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { parseCleanerSession } from '@/lib/session';

// Support both export styles
const supa = typeof _admin === 'function' ? _admin() : _admin;

/**
 * GET /api/cleaner/turns?status=needs_fix,in_progress,submitted
 * Reads cleaner session cookie, returns that cleaner's turns with property names.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sess = parseCleanerSession?.(req, res);
  if (!sess?.cleaner_id) return res.status(401).json({ error: 'not_authenticated' });

  try {
    const raw = (req.query.status || '').toString().trim();
    const wanted = raw
      ? raw.split(',').map(s => s.trim()).filter(Boolean)
      : ['needs_fix', 'in_progress', 'submitted'];

    let q = supa
      .from('turns')
      .select(`
        id,
        status,
        created_at,
        submitted_at,
        approved_at,
        needs_fix_at,
        property_id,
        properties(name)
      `)
      .eq('cleaner_id', sess.cleaner_id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (wanted?.length) q = q.in('status', wanted);

    const { data, error } = await q;
    if (error) throw error;

    const rows = (data || []).map(r => ({
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      submitted_at: r.submitted_at,
      approved_at: r.approved_at,
      needs_fix_at: r.needs_fix_at,
      property_id: r.property_id,
      property_name: r.properties?.name || '(unnamed)'
    }));

    return res.json({ rows });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
