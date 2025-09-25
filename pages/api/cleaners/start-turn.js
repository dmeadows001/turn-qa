// pages/api/cleaner/start-turn.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { cleaner_id, property_id, notes } = req.body || {};
    if (!cleaner_id || !property_id) {
      return res.status(400).json({ error: 'cleaner_id and property_id are required' });
    }

    // sanity: ensure cleaner is assigned to this property
    const { data: allowed, error: aErr } = await supabase
      .from('property_cleaners')
      .select('property_id')
      .eq('property_id', property_id)
      .eq('cleaner_id', cleaner_id)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!allowed) return res.status(403).json({ error: 'Cleaner not assigned to this property' });

    // create a turn in_progress
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .insert({
        property_id,
        cleaner_id,
        notes: notes || null,
        status: 'in_progress'
      })
      .select('id')
      .single();
    if (tErr) throw tErr;

    res.json({ ok: true, turn_id: turn.id });
  } catch (e) {
    res.status(500).json({ error: e.message || 'server error' });
  }
}
