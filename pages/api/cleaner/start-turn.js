// pages/api/cleaner/start-turn.js
import { createClient } from '@supabase/supabase-js';
import { readCleanerSession } from '@/lib/session';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { property_id, notes } = req.body || {};
    if (!property_id) return res.status(400).json({ error: 'property_id is required' });

    const sess = readCleanerSession(req);
    if (!sess) return res.status(401).json({ error: 'not_authenticated' });

    const cleaner_id = sess.cleaner_id || sess.sub;
    if (!cleaner_id) return res.status(401).json({ error: 'not_authenticated' });

    // ensure assigned
    const { data: allowed, error: aErr } = await supabase
      .from('property_cleaners')
      .select('property_id')
      .eq('property_id', property_id)
      .eq('cleaner_id', cleaner_id)
      .maybeSingle();

    if (aErr) throw aErr;
    if (!allowed) return res.status(403).json({ error: 'Cleaner not assigned to this property' });

    // lookup manager_id
    const { data: propRow, error: pErr } = await supabase
      .from('properties')
      .select('manager_id')
      .eq('id', property_id)
      .maybeSingle();

    if (pErr) throw pErr;
    const manager_id = propRow?.manager_id || null;

    // ✅ IDPOTENT: return existing in-progress turn if it exists
    const { data: existing, error: eErr } = await supabase
      .from('turns')
      .select('id')
      .eq('property_id', property_id)
      .eq('cleaner_id', cleaner_id)
      .eq('status', 'in_progress')
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (eErr) throw eErr;
    if (existing?.id) {
      return res.json({ ok: true, turn_id: existing.id, reused: true });
    }

    // create new turn only if none exists
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .insert({
        property_id,
        cleaner_id,
        manager_id,
        notes: notes || null,
        status: 'in_progress'
      })
      .select('id')
      .single();

    if (tErr) throw tErr;

    return res.json({ ok: true, turn_id: turn.id, reused: false });
  } catch (e) {
    console.error('start-turn error', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
