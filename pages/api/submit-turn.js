// pages/api/submit-turn.js
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { turnId, photos = [] } = req.body || {};
    if (!turnId) return res.status(400).json({ error: 'Missing turnId' });

    // (Optional) Persist any client-sent photo metadata here if you still do that step.

    // Mark the turn submitted
    const { data, error } = await supabaseAdmin
      .from('turns')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', turnId)
      .select('id')
      .single();

    if (error) throw error;

    return res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    console.error('submit-turn error:', e);
    return res.status(500).json({ error: e.message || 'failed' });
  }
}
