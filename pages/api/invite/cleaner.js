// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function normalizePhone(s = '') {
  // keep digits and leading +; ensure leading + for E.164 if missing
  const digits = (s || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function absUrl(req, path = '/') {
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  const host  = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const p     = path.startsWith('/') ? path : `/${path}`;
  return `${proto}://${host}${p}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { property_id, phone, name = '' } = req.body || {};
    const e164 = normalizePhone(phone);

    if (!property_id) return res.status(400).json({ error: 'property_id is required' });
    if (!e164)        return res.status(400).json({ error: 'Valid phone is required' });

    // 1) Make sure property exists (and get its name for the message)
    const { data: prop, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', property_id)
      .single();
    if (pErr || !prop) throw new Error('Property not found');

    // 2) Upsert cleaner by phone (unique on phone)
    const { data: cleanerRow, error: cErr } = await supabase
      .from('cleaners')
      .upsert({ phone: e164, name }, { onConflict: 'phone' })
      .select('id, phone')
      .single();
    if (cErr) throw cErr;

    // 3) Upsert invite (unique on property_id + phone)
    const { data: inviteRow, error: iErr } = await supabase
      .from('cleaner_invites')
      .upsert(
        { property_id, cleaner_id: cleanerRow.id, phone: e164, name },
        { onConflict: 'property_id,phone' }
      )
      .select('id')
      .single();
    if (iErr) throw iErr;

    const inviteId = inviteRow.id;

    // 4) Build onboarding link (short and friendly for trial accounts)
    const inviteUrl = absUrl(req, `/onboard/cleaner?id=${inviteId}`);

    // 5) Send SMS via Twilio (Messaging Service preferred; fallback to single number)
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('Twilio credentials missing (set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN).');

    const client = twilio(sid, token);

    const msgOpts = {
      to: e164,
      // Keep it short—Twilio trial auto-prefixes “Sent from your Twilio trial account”.
      body: `TurnQA: invite for “${prop.name}” → ${inviteUrl}`
    };

    const fromEnv =
      process.env.TWILIO_MESSAGING_SERVICE_SID
        ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
        : {
            from:
              process.env.TWILIO_FROM ||
              process.env.TWILIO_SMS_FROM || // legacy/fallback
              ''
          };

    if ('messagingServiceSid' in fromEnv) {
      msgOpts.messagingServiceSid = fromEnv.messagingServiceSid;
    } else if (fromEnv.from) {
      msgOpts.from = fromEnv.from;
    } else {
      throw new Error('Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM).');
    }

    await client.messages.create(msgOpts);

    // 6) Success
    return res.json({
      ok: true,
      invite_id: inviteId,
      cleaner_id: cleanerRow.id,
      sent_to: e164,
      link: inviteUrl
    });
  } catch (e) {
    const tip =
      'Tip: On a Twilio trial, messages can only go to verified numbers and must be short.';
    return res.status(500).json({ error: e.message || 'invite failed', tip });
  }
}
