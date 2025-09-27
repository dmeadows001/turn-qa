// pages/api/update-turn-status.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  try {
    const { turn_id, new_status, manager_note } = req.body || {};
    if (!turn_id || !new_status) return res.status(400).json({ error: 'turn_id and new_status are required' });

    const patch = {
      status: new_status,
      manager_notes: manager_note ?? null,
    };

    // optional timestamps
    if (new_status === 'needs_fix') {
      patch.needs_fix_at = new Date().toISOString();
    } else if (new_status === 'approved') {
      patch.approved_at = new Date().toISOString();
    }

    const { error } = await supabase.from('turns').update(patch).eq('id', turn_id);
    if (error) throw error;

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'update failed' });
  }
}
