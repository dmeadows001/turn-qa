// pages/api/sms/inbound.js
// Handles inbound SMS from Twilio (STOP/HELP/START). MVP: no signature validation.
// Later: add twilio.validateRequest using the raw body.

import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

export const config = { api: { bodyParser: false } }; // Twilio posts x-www-form-urlencoded

// Handle both export styles (singleton vs function)
const supabase = typeof _admin === 'function' ? _admin() : _admin;

function twiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try {
        const ct = (req.headers['content-type'] || '').toString();
        if (ct.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(data);
          const obj = {};
          for (const [k, v] of params.entries()) obj[k] = v;
          resolve(obj);
        } else if (ct.includes('application/json')) {
          resolve(JSON.parse(data || '{}'));
        } else {
          const params = new URLSearchParams(data);
          const obj = {};
          for (const [k, v] of params.entries()) obj[k] = v;
          resolve(obj);
        }
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// very light normalizer; Twilio usually sends E.164 already
function normalizePhone(s = '') {
  const digits = (s || '').trim().replace(/[^\d+]/g, '');
  if (!digits) return '';
  return digits.startsWith('+') ? digits : `+${digits}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const body = await parseBody(req);
    const fromRaw = (body.From || body.from || '').toString();
    const msgRaw  = (body.Body || body.body || '').toString();

    const from = normalizePhone(fromRaw);
    const msg  = msgRaw.trim().toUpperCase();

    // If Twilio didn’t include a phone, reply politely (still 200 so Twilio is happy)
    if (!from) {
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send(twiml('TurnQA: Missing phone.'));
    }

    const now = new Date().toISOString();
    let reply = 'Thanks for your message.';

    if (['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(msg)) {
      await supabase.from('managers').update({ sms_opt_out_at: now }).eq('phone', from);
      await supabase.from('cleaners').update({ sms_opt_out_at: now }).eq('phone', from);
      reply = 'You have been opted out of TurnQA SMS. Reply START to resubscribe.';
    } else if (['START','UNSTOP','YES'].includes(msg)) {
      await supabase.from('managers')
        .update({ sms_opt_out_at: null, sms_consent: true, sms_consent_at: now })
        .eq('phone', from);
      await supabase.from('cleaners')
        .update({ sms_opt_out_at: null, sms_consent: true, sms_consent_at: now })
        .eq('phone', from);
      reply = 'You have been re-subscribed to TurnQA SMS alerts. Reply STOP to opt out.';
    } else if (msg === 'HELP') {
      reply = 'TurnQA: Reply STOP to opt out. Email support@turnqa.com for help.';
    } else {
      reply = 'TurnQA: Thanks! Reply STOP to opt out, HELP for help.';
    }

    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml(reply));
  } catch (e) {
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml('TurnQA: Sorry, something went wrong.'));
  }
}
