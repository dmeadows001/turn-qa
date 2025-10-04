// pages/api/invite/accept.js
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// normalize phone like "+15551234567"
function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits ? (digits.startsWith('+') ? digits : `+${digits}`) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Use the service-role singleton (RLS bypass for this controlled flow)
  const supa = supabaseAdmin();

  try {
    const { invite_id, phone } = req.body || {};
    if (!invite_id) return res.status(400).json({ error: 'invite_id is required' });

    // 1) Load invite
    const { data: inv, error: invErr } = await supa
      .from('cleaner_invites')
      .select('id, property_id, phone, cleaner_id, accepted_at')
      .eq('id', invite_id)
      .maybeSingle();
    if (invErr) throw invErr;
    if (!inv) return res.status(404).json({ error: 'invite not found' });

    const normPhone = normalizePhone(phone || inv.phone || '');

    // 2) Resolve cleaner_id (find by phone or create)
    let cleanerId = inv.cleaner_id || null;

    if (!cleanerId && normPhone) {
      const { data: found, error: findErr } = await supa
        .from('cleaners')
        .select('id')
        .eq('phone', normPhone)
        .maybeSingle();
      if (findErr) throw findErr;
      cleanerId = found?.id || null;
    }

    if (!cleanerId && normPhone) {
      const { data: created, error: cErr } = await supa
        .from('cleaners')
        .insert({ phone: normPhone })
        .select('id')
        .maybeSingle();
      if (cErr) throw cErr;
      cleanerId = created?.id || null;
    }

    if (!cleanerId) {
      return res.status(400).json({ error: 'could not resolve cleaner_id' });
    }

    // 3) Mark invite as accepted & backfill cleaner_id (idempotent)
    const { error: upInvErr } = await supa
      .from('cleaner_invites')
      .update({ accepted_at: new Date().toISOString(), cleaner_id: cleanerId })
      .eq('id', invite_id);
    if (upInvErr) throw upInvErr;

    // 4) Create assignment (unique on property_id,cleaner_id to make idempotent)
    const { error: upAssignErr } = await supa
      .from('property_cleaners')
      .upsert(
        { property_id: inv.property_id, cleaner_id: cleanerId },
        { onConflict: 'property_id,cleaner_id' }
      );
    if (upAssignErr) throw upAssignErr;

    return res.status(200).json({
      ok: true,
      cleaner_id: cleanerId,
      property_id: inv.property_id,
    });
  } catch (e) {
    console.error('[invite/accept] error', e);
    return res.status(500).json({ error: e?.message || 'accept failed' });
  }
}
