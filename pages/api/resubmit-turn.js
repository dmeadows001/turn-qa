// pages/api/resubmit-turn.js
import { supabaseAdmin } from '../../lib/supabase';
import twilioPkg from 'twilio';

function absUrl(req, path) {
  const proto = (req.headers['x-forwarded-proto'] || 'https');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}${path.startsWith('/') ? '' : '/'}${path}`;
}

function pickSender(twilio) {
  const svcSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
  const from = process.env.TWILIO_FROM_NUMBER || '';
  if (!svcSid && !from) throw new Error('Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER).');
  return svcSid ? { messagingServiceSid: svcSid } : { from };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { turn_id, cleaner_message } = req.body || {};
    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });

    // 1) Load turn (+ property)
    const { data: turn, error: tErr } = await supabaseAdmin
      .from('turns')
      .select('id, property_id')
      .eq('id', turn_id)
      .single();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    const propertyId = turn.property_id;

    const { data: prop, error: pErr } = await supabaseAdmin
      .from('properties')
      .select('id, name')
      .eq('id', propertyId)
      .single();
    if (pErr) throw pErr;

    // 2) Update status back to submitted
    const { error: uErr } = await supabaseAdmin
      .from('turns')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', turn_id);
    if (uErr) throw uErr;

    // 3) Find manager phone(s) for this property (two strategies)
    let mgrPhones = [];
    // Strategy A: manager_properties join
    const { data: viaLink, error: linkErr } = await supabaseAdmin
      .from('manager_properties')
      .select('managers!inner(phone, sms_consent)')
      .eq('property_id', propertyId);
    if (!linkErr && Array.isArray(viaLink)) {
      mgrPhones = viaLink
        .map(r => r.managers?.phone)
        .filter(Boolean);
    }

    // Strategy B: properties.manager_id -> managers
    if (mgrPhones.length === 0) {
      const { data: viaProp } = await supabaseAdmin
        .from('properties')
        .select('manager_id, managers!inner(phone, sms_consent)')
        .eq('id', propertyId)
        .maybeSingle();
      if (viaProp?.managers?.phone) mgrPhones = [viaProp.managers.phone];
    }

    // De-dupe + sanitize
    mgrPhones = Array.from(new Set(mgrPhones.filter(Boolean)));

    // 4) SMS the manager(s)
    if (mgrPhones.length > 0) {
      const client = twilioPkg(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const sender = pickSender(client);

      const reviewUrl = absUrl(req, `/turns/${turn_id}/review?manager=1`);
      const shortId = `${turn_id}`.slice(0, 8);
      const cleanerLine = (cleaner_message && String(cleaner_message).trim())
        ? ` Cleaner note: ${String(cleaner_message).trim().slice(0, 140)}`
        : '';

      const body =
        `TurnQA: Fixes submitted for "${prop?.name || 'Property'}" (turn ${shortId}). Review: ${reviewUrl}.${cleanerLine} Reply STOP to opt out.`;

      await Promise.all(mgrPhones.map(phone =>
        client.messages.create({
          ...sender,
          to: phone,
          body
        })
      ));
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('resubmit-turn error:', e);
    res.status(500).json({ error: e.message || 'failed' });
  }
}
