// pages/api/sms/otp-send.js
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ----- helpers -----
function e164(s = '') {
  const digits = String(s || '').replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : '+' + digits;
}
function pickSender() {
  const msid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  // Support common aliases; you said you use TWILIO_FROM_NUMBER
  let from =
    (process.env.TWILIO_FROM || '').trim() ||
    (process.env.TWILIO_FROM_NUMBER || '').trim() ||
    (process.env.TWILIO_PHONE_NUMBER || '').trim() ||
    (process.env.TWILIO_TOLL_FREE || '').trim() ||
    (process.env.TWILIO_TF_FROM || '').trim();

  if (msid) return { type: 'ms', msid };
  if (from) return { type: 'from', from: from.startsWith('MG') ? from : e164(from) };
  return { type: 'none' };
}
function twilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !tok) return null;
  return twilio(sid, tok);
}
const mask = s => !s ? s : s.startsWith('MG')
  ? s.slice(0,2) + '••••' + s.slice(-4)
  : s.startsWith('+') ? s.slice(0,3) + '•••' + s.slice(-2) : '••••';

// ----- handler -----
export default async function handler(req, res) {
  // Debug probe to prove what this lambda sees in Production
  if (req.method === 'GET' && 'debug' in req.query) {
    const sender = pickSender();
    return res.json({
      hasSid: !!(process.env.TWILIO_ACCOUNT_SID || '').trim(),
      hasTok: !!(process.env.TWILIO_AUTH_TOKEN || '').trim(),
      senderType: sender.type,
      from: sender.from ? mask(sender.from) : null,
      msid: sender.msid ? mask(sender.msid) : null,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const client = twilioClient();
    const sender = pickSender();
    if (!client || sender.type === 'none') {
      return res.status(500).json({
        error:
          'Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM / TWILIO_FROM_NUMBER).'
      });
    }

    // Accept { phone } (from your onboard page), or resolve from ids if provided
    const { phone, to, invite_id, cleaner_id } = req.body || {};
    let dest = phone || to || '';

    if (!dest) {
      // optional lookups if you wire them later
      if (invite_id) {
        const { data } = await supabase
          .from('cleaner_invites')
          .select('phone')
          .eq('id', invite_id)
          .maybeSingle();
        dest = data?.phone || '';
      } else if (cleaner_id) {
        const { data } = await supabase
          .from('cleaners')
          .select('phone')
          .eq('id', cleaner_id)
          .maybeSingle();
        dest = data?.phone || '';
      }
    }

    if (!dest) return res.status(400).json({ error: 'No destination phone.' });

    const e = e164(dest);
    if (!/^\+\d{8,15}$/.test(e)) return res.status(400).json({ error: 'Invalid phone format.' });

    // Generate and store 6-digit OTP, 10-min expiry
    const code = String(Math.floor(100000 + Math.random() * 900000)).slice(0,6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: upErr } = await supabase
      .from('sms_otp')
      .upsert(
        { phone: e, code, expires_at: expiresAt },  // phone is PK, so onConflict implicit
        { onConflict: 'phone' }
      );
    if (upErr) throw upErr;

    // Short, trial-safe message
    const body = `TurnQA code: ${code}. Reply STOP to opt out, HELP for help.`;

    const payload = sender.type === 'ms'
      ? { to: e, body, messagingServiceSid: sender.msid }
      : { to: e, body, from: sender.from };

    await client.messages.create(payload);

    return res.json({ ok: true, to: e, via: sender.type });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
