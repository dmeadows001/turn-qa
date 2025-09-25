// pages/api/sms/otp-send.js
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : '+' + digits;
}

function resolveSender() {
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
  const from =
    process.env.TWILIO_FROM ||
    process.env.TWILIO_PHONE_NUMBER ||
    process.env.TWILIO_TOLL_FREE ||
    process.env.TWILIO_TF_FROM ||
    '';

  if (messagingServiceSid) return { messagingServiceSid };
  if (from) return { from };
  return null;
}

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { to, invite_id, cleaner_id, phone, code } = req.body || {};
    let dest = to || phone || '';

    // If no explicit phone, try to look it up from invite or cleaner
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
    if (!/^\+\d{8,15}$/.test(e164)) {
      return res.status(400).json({ error: 'Invalid destination phone (must be E.164).' });
    }

    const client = getTwilioClient();
    const sender = resolveSender();
    if (!client || !sender) {
      return res.status(500).json({
        error:
          'Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM).'
      });
    }

    // Use provided code or generate a 6-digit one (your verify endpoint can check it)
    const codeToSend =
      (code && String(code).trim()) ||
      String(Math.floor(100000 + Math.random() * 900000)).slice(0, 6);

    // Keep the body short for Twilio trial accounts
    const body = `TurnQA code: ${codeToSend}. Reply STOP to opt out, HELP for help.`;

    const payload = {
      to: e164,
      body,
      ...(sender.messagingServiceSid
        ? { messagingServiceSid: sender.messagingServiceSid }
        : { from: sender.from })
    };

    await client.messages.create(payload);

    res.json({
      ok: true,
      to: e164,
      via: sender.messagingServiceSid ? 'messaging_service' : 'from_number'
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
