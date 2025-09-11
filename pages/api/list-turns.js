// pages/api/list-turns.js
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const {
      status,          // 'submitted', 'approved', etc.
      property_id,     // UUID
      date_from,       // 'YYYY-MM-DD'
      date_to,         // 'YYYY-MM-DD'
      limit = 50,
      offset = 0,
    } = body;

    let q = supabaseAdmin
      .from('turns')
      .select(`
        id,
        status,
        turn_date,
        cleaner_name,
        submitted_at,
        created_at,
        property_id,
        properties!inner ( name ),
        turn_photos(count),
        qa_findings(count)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Math.max(0, Math.min(limit, 200)) - 1);

    if (status) q = q.eq('status', status);
    if (property_id) q = q.eq('property_id', property_id);
    if (date_from) q = q.gte('turn_date', date_from);
    if (date_to) q = q.lte('turn_date', date_to);

    const { data, error } = await q;
    if (error) throw error;

    // Flatten property name and counts
    const turns = (data || []).map(row => ({
      id: row.id,
      status: row.status,
      turn_date: row.turn_date,
      cleaner_name: row.cleaner_name,
      submitted_at: row.submitted_at,
      created_at: row.created_at,
      property_id: row.property_id,
      property_name: row.properties?.name || null,
      photo_count: Array.isArray(row.turn_photos) && row.turn_photos[0]?.count != null
        ? row.turn_photos[0].count : 0,
      finding_count: Array.isArray(row.qa_findings) && row.qa_findings[0]?.count != null
        ? row.qa_findings[0].count : 0,
    }));

    res.status(200).json({ turns });
  } catch (e) {
    console.error('list-turns error:', e);
    res.status(500).json({ error: e.message || 'failed' });
  }
}
