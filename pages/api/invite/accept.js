// pages/api/invite/accept.js
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// normalize phone like "+15551234567"
function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits ? (digits.startsWith('+') ? digits : `+${digits}`) : '';
}

// ---- SMS helpers (non-blocking use) ----
function canSendSMS(rec) {
  if (!rec) return { ok: false, reason: 'no_recipient' };
  if (!rec.phone) return { ok: false, reason: 'no_phone' };
  if (rec.sms_consent !== true) return { ok: false, reason: 'no_consent' };
  if (rec.sms_opt_out_at) return { ok: false, reason: 'opted_out' };
  return { ok: true };
}

async function twilioSend({ to, body }) {
  const sid  = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok  = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const msid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const from = (process.env.TWILIO_FROM_NUMBER || '').trim();
  if (!sid || !tok || (!msid && !from)) return { ok: false, reason: 'twilio_not_configured' };

  const { default: twilio } = await import('twilio');
  const client = twilio(sid, tok);
  const payload = msid ? { to, body, messagingServiceSid: msid } : { to, body, from };
  const msg = await client.messages.create(payload);
  return { ok: true, sid: msg.sid };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // service-role client (RLS bypass for this controlled flow)
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

    // 2) Resolve cleaner_id (find by phone or create with safe defaults)
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
        .insert({
          phone: normPhone,
          // satisfy NOT NULL explicitly
          sms_consent: false
        })
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

    // 5) Notify the property's manager (best-effort, non-blocking)
    (async () => {
      try {
        // load property -> manager
        const { data: prop } = await supa
          .from('properties')
          .select('id, name, manager_id')
          .eq('id', inv.property_id)
          .maybeSingle();

        if (!prop?.manager_id) return;

        const { data: mgr } = await supa
          .from('managers')
          .select('id, name, phone, sms_consent, sms_opt_out_at')
          .eq('id', prop.manager_id)
          .maybeSingle();

        const guard = canSendSMS(mgr);
        if (!guard.ok) return;

        const body = `TurnQA: Cleaner ${normPhone || 'a cleaner'} accepted the invite for "${prop.name || 'a property'}".`;
        await twilioSend({ to: mgr.phone, body });
      } catch (notifyErr) {
        console.warn('[invite/accept] manager notify failed', notifyErr);
      }
    })();

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
