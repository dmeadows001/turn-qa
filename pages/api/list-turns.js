// pages/api/list-turns.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { status, from, to, limit = 200 } = req.query;

    let query = supabase
      .from('turns')
      // thanks to the FK, we can embed the related property row
      .select(`
        id,
        created_at,
        submitted_at,
        approved_at,
        needs_fix_at,
        status,
        property_id,
        properties:properties (
          name
        )
      `)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (status) query = query.eq('status', status);
    if (from)   query = query.gte('created_at', from);
    if (to)     query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) throw error;

    // shape into a simple list the UI can use
    const rows = (data || []).map(r => ({
      id: r.id,
      created_at: r.created_at,
      submitted_at: r.submitted_at,
      approved_at: r.approved_at,
      needs_fix_at: r.needs_fix_at,
      status: r.status,
      property_id: r.property_id,
      property_name: r.properties?.name || '(unnamed)'
    }));

    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
