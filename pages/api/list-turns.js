// pages/api/list-turns.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Works whether supabaseAdmin exports an instance or a factory
const supabase = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { status, from, to, limit: limitParam, property_id } = req.query;

    const requestedLimit = Number(limitParam ?? 200);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 1000)
      : 200;

    // Read from the view (manager_turns) so the shape is already flat
    let query = supabase
      .from('manager_turns')
      .select(`
        id,
        created_at,
        submitted_at,
        approved_at,
        needs_fix_at,
        status,
        property_id,
        property_name
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    // ✅ NEW: property filter (only if provided)
    if (property_id) query = query.eq('property_id', String(property_id));

    const { data, error } = await query;
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

    return res.status(200).json({ rows });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
