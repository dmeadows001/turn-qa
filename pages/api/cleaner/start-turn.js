// pages/api/cleaner/start-turn.js
import { createClient } from '@supabase/supabase-js';
import { parseCleanerSession } from '@/lib/session'; // must exist alongside makeCleanerSession

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 1) Get the cleaner from the secure cookie (set by /api/otp/verify)
    const sess = parseCleanerSession(req); // { cleaner_id, phone } or null
    if (!sess?.cleaner_id) {
      return res.status(401).json({ error: 'not_authenticated' });
    }

    const { property_id, notes } = req.body || {};
    if (!property_id) {
      return res.status(400).json({ error: 'property_id is required' });
    }

    // 2) Authorization: ensure this cleaner is assigned to the property
    const { data: allowed, error: aErr } = await supabase
      .from('property_cleaners')
      .select('property_id')
      .eq('property_id', property_id)
      .eq('cleaner_id', sess.cleaner_id)
      .maybeSingle();

    if (aErr) throw aErr;
    if (!allowed) {
      return res.status(403).json({ error: 'Cleaner not assigned to this property' });
    }

    // 3) Create the in-progress turn
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .insert({
        property_id,
        cleaner_id: sess.cleaner_id,
        notes: notes || null,
        status: 'in_progress'
      })
      .select('id')
      .single();

    if (tErr) throw tErr;

    return res.json({ ok: true, turn_id: turn.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
