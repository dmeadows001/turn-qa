// pages/api/get-turn.js
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    const id = (req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { data, error } = await supabaseAdmin
      .from('turns')
      .select(`
        id,
        status,
        cleaner_name,
        turn_date,
        property_id,
        manager_notes,
        cleaner_reply,
        submitted_at,
        resubmitted_at,
        approved_at,
        created_at
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Turn not found' });

    res.status(200).json({ turn: data });
  } catch (e) {
    console.error('get-turn error:', e);
    res.status(500).json({ error: e.message || 'failed' });
  }
}
