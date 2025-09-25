// pages/api/sms/otp-send.js
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// E.164 for destination numbers (not applied to MG SIDs)
function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : '+' + digits;
}

function pickSender() {
  const msid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  let from =
    (process.env.TWILIO_FROM || '').trim() ||
    (process.env.TWILIO_PHONE_NUMBER || '').trim() ||
    (process.env.TWILIO_TOLL_FREE || '').trim() ||
    (process.env.TWILIO_TF_FROM || '').trim();

  if (msid) return { type: 'ms', messagingServiceSid: msid };
  if (from) {
    // Clean up number formats; keep MG… SIDs untouched
    from = from.startsWith('MG') ? from : normalizePhone(from);
    return { type: 'from', from };
  }
  return { type: 'none' };
}

function twilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) return null;
  return twilio(sid, token);
}

// Allow GET ?debug=1 to show exactly what this lambda sees
export default async function handler(req, res) {
  // Debug probe (handy to confirm the env FROM/MSID in THIS function)
  if (req.method === 'GET' && 'debug' in req.query) {
    const sender = pickSender();
    const hasSid = !!(process.env.TWILIO_ACCOUNT_SID || '').trim();
    const hasTok = !!(process.env.TWILIO_AUTH_TOKEN || '').trim();
    return res.json({
      hasSid,
      hasTok,
      senderType: sender.type,
      from: sender.from ? mask(sender.from) : null,
      msid: sender.messagingServiceSid ? mask(sender.messagingServiceSid) : null,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { to, phone, invite_id, cleaner_id, code } = req.body || {};
    let dest = to || phone || '';

    // Look up a phone if only IDs are provided
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

    if (!dest) return res.status(400).json({ error: 'No destination phone found.' });
    const e164 = normalizePhone(dest);
    if (!/^\+\d{8,15}$/.test(e164)) return res.status(400).json({ error: 'Invalid phone (E.164 required).' });

    const client = twilioClient();
    const sender = pickSender();
    if (!client || sender.type === 'none') {
      return res.status(500).json({
        error:
          'Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM).',
        debug: {
          hasSid: !!(process.env.TWILIO_ACCOUNT_SID || '').trim(),
          hasTok: !!(process.env.TWILIO_AUTH_TOKEN || '').trim(),
          fromPresent: !!(
            (process.env.TWILIO_FROM ||
              process.env.TWILIO_PHONE_NUMBER ||
              process.env.TWILIO_TOLL_FREE ||
              process.env.TWILIO_TF_FROM ||
              ''
            ).trim()
          ),
          msidPresent: !!(process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim(),
        }
      });
    }

    const codeToSend =
      (code && String(code).trim()) ||
      String(Math.floor(100000 + Math.random() * 900000)).slice(0, 6);

    const body = `TurnQA code: ${codeToSend}. Reply STOP to opt out, HELP for help.`;

    const payload =
      sender.type === 'ms'
        ? { to: e164, body, messagingServiceSid: sender.messagingServiceSid }
        : { to: e164, body, from: sender.from };

    await client.messages.create(payload);

    return res.json({
      ok: true,
      to: e164,
      via: sender.type,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}

function mask(s) {
  if (!s) return s;
  if (s.startsWith('MG')) return s.slice(0, 2) + '••••' + s.slice(-4);
  if (s.startsWith('+')) return s.slice(0, 3) + '•••' + s.slice(-2);
  return '••••';
}
