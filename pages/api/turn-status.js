// pages/api/turn-status.js
import { supabaseClient } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    const { turnId } = req.query;
    if (!turnId) return res.status(400).json({ error: 'Missing turnId' });

    const { data, error } = await supabaseClient
      .from('turns')
      .select('status')
      .eq('id', turnId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Turn not found' });

    res.status(200).json({ status: data.status });
  } catch (e) {
    console.error('turn-status error:', e);
    res.status(500).json({ error: 'turn-status failed' });
  }
}
