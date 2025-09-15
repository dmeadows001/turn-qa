// pages/api/managers/list-turns.js
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x'); // dummy base
    const status = url.searchParams.get('status') || ''; // e.g. submitted, approved, needs_fix, in_progress
    const from = url.searchParams.get('from');           // YYYY-MM-DD (service date)
    const to = url.searchParams.get('to');               // YYYY-MM-DD (service date, inclusive)

    let q = supabaseAdmin
      .from('turns')
      .select('id, property_id, cleaner_name, turn_date, status, submitted_at, approved_at, created_at')
      .order('turn_date', { ascending: false });

    if (status) q = q.eq('status', status);
    if (from)  q = q.gte('turn_date', from);
    if (to)    q = q.lte('turn_date', to);

    const { data, error } = await q;
    if (error) throw error;

    res.status(200).json({ turns: data || [] });
  } catch (e) {
    console.error('managers/list-turns error:', e);
    res.status(500).json({ error: e.message || 'failed' });
  }
}
