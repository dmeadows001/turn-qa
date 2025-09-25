// pages/api/sms/otp-send.js
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  // use service role if you have it; anon is fine because policy above allows insert/upsert
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function normalizePhone(s = "") {
  const digits = (s || "").replace(/[^\d+]/g, "");
  if (!digits.startsWith("+")) return "+" + digits.replace(/^(\+)+/, "");
  return digits;
}

function twilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  return twilio(sid, tok);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const to = normalizePhone(phone);

    // create a 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // upsert into sms_otp
    const { error: upErr } = await supabase
      .from('sms_otp')
      .upsert({ phone: to, code, expires_at: expires })
      .eq('phone', to);
    if (upErr) throw upErr;

    // Prepare Twilio
    const client = twilioClient();
    const serviceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || "";
    const from = process.env.TWILIO_FROM || "";

    if (!client || (!serviceSid && !from)) {
      return res.status(500).json({ error: 'Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILLO_FROM)' });
    }

    // super short trial-safe body
    const body = `TurnQA code: ${code}. Reply STOP to opt out, HELP for help.`;

    const msgPayload = {
      to,
      body,
      ...(serviceSid ? { messagingServiceSid: serviceSid } : { from })
    };

    await client.messages.create(msgPayload);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
