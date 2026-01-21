// pages/api/start-turn.js
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits ? (digits.startsWith('+') ? digits : `+${digits}`) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const supa = supabaseAdmin();

  try {
    const { phone, property_id /*, notes */ } = req.body || {};
    if (!phone)       return res.status(400).json({ error: 'phone is required' });
    if (!property_id) return res.status(400).json({ error: 'property_id is required' });

    const normPhone = normalizePhone(phone);

    // 1) Verify property exists
    {
      const { data: prop, error: pErr } = await supa
        .from('properties')
        .select('id, manager_id')
        .eq('id', property_id)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!prop) return res.status(404).json({ error: 'property not found' });
    }

    const manager_id = prop?.manager_id || null;

    // 2) Find cleaner by phone
    const { data: cleaner, error: cErr } = await supa
      .from('cleaners')
      .select('id')
      .eq('phone', normPhone)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!cleaner?.id) {
      return res.status(404).json({ error: 'cleaner not found for this phone' });
    }
    const cleaner_id = cleaner.id;

    // 3) Ensure assignment exists (idempotent)
    //    Requires a unique index on (property_id, cleaner_id) in property_cleaners.
    const { error: assignErr } = await supa
      .from('property_cleaners')
      .upsert(
        { property_id, cleaner_id },
        { onConflict: 'property_id,cleaner_id' }
      );
    if (assignErr) throw assignErr;

    // 4) Create turn (status = in_progress)
    const { data: turnRow, error: tErr } = await supa
      .from('turns')
      .insert({ property_id, cleaner_id, manager_id, status: 'in_progress' })
      .select('id')
      .maybeSingle();
    if (tErr) throw tErr;
    if (!turnRow?.id) throw new Error('could not create turn');

    return res.status(200).json({ ok: true, turn_id: turnRow.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'start failed' });
  }
}
