// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  // Service role lets this route bypass RLS
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function absUrl(req, path = '/') {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizePhone(s = '') {
  const digits = String(s).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  // assume US 10-digit if no +country code
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { property_id, phone: rawPhone, name = '' } = req.body || {};
    if (!property_id) throw new Error('property_id is required');
    if (!rawPhone)    throw new Error('phone is required');

    const phone = normalizePhone(rawPhone);

    // 1) Ensure property exists (for name in SMS)
    const { data: prop, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', property_id)
      .single();
    if (pErr) throw pErr;

    // 2) Find or create the cleaner by phone
    let { data: cleaner, error: cSelErr } = await supabase
      .from('cleaners')
      .select('id, name, phone, sms_consent')
      .eq('phone', phone)
      .maybeSingle();
    if (cSelErr) throw cSelErr;

    if (!cleaner) {
      const { data: created, error: cInsErr } = await supabase
        .from('cleaners')
        .insert({ name: name || null, phone })
        .select('id, name, phone, sms_consent')
        .single();
      if (cInsErr) throw cInsErr;
      cleaner = created;
    }

    // 3) Upsert the invite (idempotent if it already exists)
    const { data: inviteRow, error: iErr } = await supabase
      .from('cleaner_invites')
      .upsert(
        { cleaner_id: cleaner.id, property_id },
        { onConflict: 'cleaner_id,property_id' }
      )
      .select('id')
      .single();
    if (iErr) throw iErr;
    const inviteId = inviteRow.id;

    // 4) Build onboarding link (use absolute URL; the cleaner page reads ?id=<cleaner_id>)
    const link = absUrl(req, `/onboard/cleaner?id=${cleaner.id}`);

    // 5) Send SMS (Messaging Service preferred, else FROM)
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const body = `TurnQA invite for ${prop.name}: ${link} Reply STOP to opt out.`;

    const msgOpts = {
      to: phone,
      body
    };
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      msgOpts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else if (process.env.TWILIO_FROM) {
      msgOpts.from = process.env.TWILIO_FROM;
    } else {
      throw new Error('Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM).');
    }

    await client.messages.create(msgOpts);

    return res.json({
      ok: true,
      invite_id: inviteId,
      cleaner_id: cleaner.id,
      sent_to: phone
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'internal error' });
  }
}
