// pages/api/cleaner/start-turn.js
import { createClient } from '@supabase/supabase-js';
import { readCleanerSession } from '@/lib/session'; // ✅ use the existing helper

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { property_id, notes } = req.body || {};
    if (!property_id) return res.status(400).json({ error: 'property_id is required' });

    // ✅ get cleaner identity from the session cookie (set by /api/otp/verify)
    const sess = readCleanerSession(req);
    if (!sess) return res.status(401).json({ error: 'not_authenticated' });

    // depending on how you shaped the session, one of these should be present
    const cleaner_id = sess.cleaner_id || sess.sub;
    if (!cleaner_id) return res.status(401).json({ error: 'not_authenticated' });

    // sanity: ensure this cleaner is assigned to the property
    const { data: allowed, error: aErr } = await supabase
      .from('property_cleaners')
      .select('property_id')
      .eq('property_id', property_id)
      .eq('cleaner_id', cleaner_id)
      .maybeSingle();

    if (aErr) throw aErr;
    if (!allowed) return res.status(403).json({ error: 'Cleaner not assigned to this property' });

    // create the turn
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

    return res.json({ ok: true, turn_id: turn.id });
  } catch (e) {
    console.error('start-turn error', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
