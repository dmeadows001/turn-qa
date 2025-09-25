// pages/api/sms/otp-send.js
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// E.164 formatter for destination numbers
function e164(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : '+' + digits;
}

// Read a sender from env. Supports multiple names, incl. TWILIO_FROM_NUMBER
function pickSender() {
  const msid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();

  let from =
    (process.env.TWILIO_FROM || '').trim() ||
    (process.env.TWILIO_FROM_NUMBER || '').trim() ||   // <-- alias supported
    (process.env.TWILIO_PHONE_NUMBER || '').trim() ||
    (process.env.TWILIO_TOLL_FREE || '').trim() ||
    (process.env.TWILIO_TF_FROM || '').trim();

  if (msid) return { type: 'ms', msid };
  if (from) {
    if (!from.startsWith('MG')) from = e164(from);
    return { type: 'from', from };
  }
  return { type: 'none' };
}

function twilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !tok) return null;
  return twilio(sid, tok);
}

// Small helper to mask values in debug output
const mask = s => !s ? s : s.startsWith('MG')
  ? s.slice(0,2) + '••••' + s.slice(-4)
  : s.startsWith('+') ? s.slice(0,3) + '•••' + s.slice(-2) : '••••';

export default async function handler(req, res) {
  // GET probe: /api/sms/otp-send?debug=1
  if (req.method === 'GET' && 'debug' in req.query) {
    const s = pickSender();
    return res.json({
      hasSid: !!(process.env.TWILIO_ACCOUNT_SID || '').trim(),
      hasTok: !!(process.env.TWILIO_AUTH_TOKEN || '').trim(),
      senderType: s.type,
      from: s.from ? mask(s.from) : null,
      msid: s.msid ? mask(s.msid) : null,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const client = twilioClient();
    const sender = pickSender();
    if (!client || sender.type === 'none') {
      return res.status(500).json({
        error: 'Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM / TWILIO_FROM_NUMBER).'
      });
    }

    // Accept multiple ways to specify destination
    const { to, phone, invite_id, cleaner_id, code } = req.body || {};
    let dest = to || phone || '';

    // Optional: resolve phone by IDs
    if (!dest) {
      if (invite_id) {
        const { data, error } = await supabase
          .from('cleaner_invites')
          .select('phone')
          .eq('id', invite_id)
          .single();
        if (error) throw error;
        dest = data?.phone || '';
      } else if (cleaner_id) {
        const { data, error } = await supabase
          .from('cleaners')
          .select('phone')
          .eq('id', cleaner_id)
          .single();
        if (error) throw error;
        dest = data?.phone || '';
      }
    }

    if (!dest) return res.status(400).json({ error: 'No destination phone.' });
    const e = e164(dest);
    if (!/^\+\d{8,15}$/.test(e)) return res.status(400).json({ error: 'Invalid phone format.' });

    const codeToSend = (code ? String(code) : String(Math.floor(100000 + Math.random() * 900000))).slice(0, 6);
    const body = `TurnQA code: ${codeToSend}. Reply STOP to opt out, HELP for help.`;

    const payload = sender.type === 'ms'
      ? { to: e, body, messagingServiceSid: sender.msid }
      : { to: e, body, from: sender.from };

    await client.messages.create(payload);

    return res.json({ ok: true, to: e, via: sender.type });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
