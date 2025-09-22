// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';
import { absUrl } from '../../../lib/origin';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  // service role for secure server mutations (bypasses RLS)
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// Lazy Twilio init so local builds don't crash without creds
function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  // eslint-disable-next-line global-require
  const Twilio = require('twilio');
  return new Twilio(sid, tok);
}

function normalizeUSPhone(raw = '') {
  // Keep digits; add + prefix for E.164 (trial-safe shortest)
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { property_id, phone, name } = req.body || {};
    if (!property_id) return res.status(400).json({ error: 'property_id is required' });
    if (!phone)       return res.status(400).json({ error: 'phone is required' });

    // 1) Confirm property (for the name in SMS)
    const { data: prop, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', property_id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!prop) return res.status(404).json({ error: 'Property not found' });

    // 2) Upsert cleaner by phone (unique index on cleaners.phone)
    const e164 = normalizeUSPhone(phone);
    if (!e164) return res.status(400).json({ error: 'Invalid phone number' });

    const { data: cleaner, error: cErr } = await supabase
      .from('cleaners')
      .upsert({ phone: e164, name: name || null }, { onConflict: 'phone' })
      .select('id, phone, name')
      .maybeSingle();
    if (cErr) throw cErr;

    // 3) Create an invite row (uuid id) for this cleaner + property
    const { data: inv, error: iErr } = await supabase
      .from('cleaner_invites')
      .insert({ cleaner_id: cleaner.id, property_id })
      .select('id')
      .single();
    if (iErr) throw iErr;

    // 4) Build absolute onboarding URL
    const inviteId = inv.id;                 // <-- this is the defined ID
    const inviteUrl = absUrl(req, `/onboard/cleaner?id=${inviteId}`);

    // 5) Send short SMS (trial safe). Prefer Messaging Service if present
    let sms = 'skipped_no_twilio';
    const tw = getTwilio();
    if (tw && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM)) {
      const body = `TurnQA: Join ${prop.name || 'property'}: ${inviteUrl} STOP=stop HELP=help`;
      const msgOpts = {
        to: e164,
        body
      };
      if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
        msgOpts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      } else {
        msgOpts.from = process.env.TWILIO_FROM;
      }

      try {
        const sent = await tw.messages.create(msgOpts);
        sms = sent?.sid ? 'sent' : 'not_sent';
      } catch (e) {
        console.error('[invite/cleaner] Twilio error:', e?.message || e);
        sms = 'twilio_error';
      }
    }

    return res.json({
      ok: true,
      invite_id: inviteId,
      invite_url: inviteUrl,
      cleaner_id: cleaner.id,
      sms
    });
  } catch (e) {
    console.error('[invite/cleaner] ERROR:', e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
