// pages/api/cleaner/start-turn.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Works whether supabaseAdmin exports an instance or a factory
const supabase = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { cleaner_id, property_id, notes } = req.body || {};
    if (!cleaner_id || !property_id) {
      return res.status(400).json({ error: 'cleaner_id and property_id are required' });
    }

    // 1) Ensure cleaner is assigned to this property (prevents random starts)
    const { data: allowed, error: aErr } = await supabase
      .from('property_cleaners')
      .select('property_id')
      .eq('property_id', property_id)
      .eq('cleaner_id', cleaner_id)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!allowed) {
      return res.status(403).json({ error: 'Cleaner not assigned to this property' });
    }

    // 2) Create the turn
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .insert({
        property_id,
        cleaner_id,
        status: 'in_progress',
        notes: notes || null
      })
      .select('id')
      .single();
    if (tErr) throw tErr;

    return res.json({ ok: true, turn_id: turn.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
