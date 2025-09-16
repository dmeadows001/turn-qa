// pages/api/sms/inbound.js
// Handles inbound SMS from Twilio (STOP/HELP/START). For MVP we skip signature validation.
// Later: add validation via twilio.validateRequest with raw body.
import { createClient } from '@supabase/supabase-js';
import { parse } from 'url';

export const config = { api: { bodyParser: false } }; // Twilio sends x-www-form-urlencoded

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function twiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try {
        const ct = req.headers['content-type'] || '';
        if (ct.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(data);
          const obj = {};
          for (const [k, v] of params.entries()) obj[k] = v;
          resolve(obj);
        } else if (ct.includes('application/json')) {
          resolve(JSON.parse(data || '{}'));
        } else {
          // Try form anyway
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const body = await parseBody(req);
    const from = (body.From || body.from || '').trim(); // E.164
    const msg  = (body.Body || body.body || '').trim().toUpperCase();

    // Basic routing: update both managers & cleaners that match this phone
    const now = new Date().toISOString();
    let reply = 'Thanks for your message.';

    if (['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(msg)) {
      await supabase.from('managers').update({ sms_opt_out_at: now }).eq('phone', from);
      await supabase.from('cleaners').update({ sms_opt_out_at: now }).eq('phone', from);
      reply = 'You have been opted out of TurnQA SMS. Reply START to resubscribe.';

    } else if (['START','UNSTOP','YES'].includes(msg)) {
      await supabase.from('managers').update({ sms_opt_out_at: null, sms_consent: true, sms_consent_at: now }).eq('phone', from);
      await supabase.from('cleaners').update({ sms_opt_out_at: null, sms_consent: true, sms_consent_at: now }).eq('phone', from);
      reply = 'You have been re-subscribed to TurnQA SMS alerts. Reply STOP to opt out.';

    } else if (msg === 'HELP') {
      reply = 'TurnQA: Reply STOP to opt out. Email support@turnqa.com for help.';

    } else {
      // No-op for general inbound; you can log if you want
      reply = 'TurnQA: Thanks! Reply STOP to opt out, HELP for help.';
    }

    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml(reply));
  } catch (e) {
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml('TurnQA: Sorry, something went wrong.'));
  }
}
