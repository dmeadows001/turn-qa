// pages/api/cleaner/start-turn.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Support both “function that returns a client” and “client” exports
const supa = typeof _admin === 'function' ? _admin() : _admin;

function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits ? (digits.startsWith('+') ? digits : `+${digits}`) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { phone, cleaner_id, property_id, notes } = req.body || {};

    // Prefer cleaner_id. (phone is optional convenience)
    let cid = (cleaner_id || '').toString().trim();

    if (!cid && phone) {
      const norm = normalizePhone(phone);
      const { data: cl, error: cErr } = await supa
        .from('cleaners')
        .select('id')
        .eq('phone', norm)
        .maybeSingle();
      if (cErr) throw cErr;
      cid = cl?.id || '';
    }

    if (!cid) return res.status(400).json({ ok: false, error: 'cleaner_id (or phone) is required' });
    if (!property_id) return res.status(400).json({ ok: false, error: 'property_id is required' });

    // Verify property exists
    {
      const { data: prop, error: pErr } = await supa
        .from('properties')
        .select('id')
        .eq('id', property_id)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!prop) return res.status(404).json({ ok: false, error: 'property not found' });
    }

    // Ensure assignment exists (idempotent)
    const { error: upAssignErr } = await supa
      .from('property_cleaners')
      .upsert(
        { property_id, cleaner_id: cid },
        { onConflict: 'property_id,cleaner_id' }
      );
    if (upAssignErr) throw upAssignErr;

    // Create turn
    const { data: turn, error: tErr } = await supa
      .from('turns')
      .insert({
        property_id,
        cleaner_id: cid,
        status: 'in_progress',
        ...(notes ? { notes } : {}),
      })
      .select('id')
      .maybeSingle();

    if (tErr) throw tErr;
    if (!turn?.id) throw new Error('could not create turn');

    return res.status(200).json({ ok: true, turn_id: turn.id });
  } catch (e) {
    console.error('[cleaner/start-turn] error:', e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || 'start failed' });
  }
}
