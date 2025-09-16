// pages/api/otp/send.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function randCode() {
  return ('' + Math.floor(100000 + Math.random() * 900000));
}

async function findOptOutByPhone(phone) {
  // Check both managers and cleaners tables for an opt-out flag on this phone
  let optedOut = false;

  const { data: m, error: mErr } = await supabase
    .from('managers')
    .select('sms_opt_out_at')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (!mErr && m && m.sms_opt_out_at) optedOut = true;

  const { data: c, error: cErr } = await supabase
    .from('cleaners')
    .select('sms_opt_out_at')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (!cErr && c && c.sms_opt_out_at) optedOut = true;

  return optedOut;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { 
    res.setHeader('Allow',['POST']); 
    return res.status(405).json({ error: 'Method not allowed' }); 
  }

  try {
    const { role, subject_id, name, phone, consent } = req.body || {};
    if (!role || !['manager','cleaner'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!consent) return res.status(400).json({ error: 'consent required' });

    // Opt-out guard: if this phone has previously replied STOP, do NOT send OTP.
    // (Carriers/Twilio will block anyway with 21610; we fail fast with a helpful message.)
    const isOptedOut = await findOptOutByPhone(phone);
    if (isOptedOut) {
      const sender = process.env.TWILIO_FROM_NUMBER || '(your TurnQA number)';
      return res.status(400).json({
        error: 'opted_out',
        message: `This number has opted out of SMS. Please text START to ${sender} to re-subscribe, then try again.`
      });
    }

    // Ensure we have a subject record and the right phone saved
    const table = role === 'manager' ? 'managers' : 'cleaners';
    let sid = subject_id;

    if (!sid) {
      // Create a new subject if not provided
      const { data, error } = await supabase
        .from(table)
        .insert({ name: name || role, phone })
        .select('id')
        .single();
      if (error) throw error;
      sid = data.id;
    } else {
      // Update existing subject's phone to the one being verified
      const { error: upErr } = await supabase
        .from(table)
        .update({ phone })
        .eq('id', sid);
      if (upErr) throw upErr;
    }

    // Create OTP
    const code = randCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
    const { error: iErr } = await supabase.from('phone_otps').insert({
      role, subject_id: sid, phone, code, expires_at: expires
    });
    if (iErr) throw iErr;

    // Send OTP via Twilio (Messaging Service preferred)
    const { default: twilio } = await import('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const body = `TurnQA code: ${code}. Reply STOP to opt out, HELP for help.`;
    const opts = { to: phone, body };
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      opts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else {
      opts.from = process.env.TWILIO_FROM_NUMBER;
    }

    const msg = await client.messages.create(opts);

    return res.status(200).json({ ok: true, subject_id: sid, sms: { sid: msg.sid } });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
