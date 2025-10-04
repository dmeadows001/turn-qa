// pages/api/otp/send.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Handle both export styles (function returning a client vs direct client)
const supabase = typeof _admin === 'function' ? _admin() : _admin;

function e164(s = '') {
  const digits = String(s || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  // naive US default if 10 digits; adjust if you need intl behavior
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  return `+${digits}`;
}

function randCode() {
  return String(Math.floor(100000 + Math.random() * 900000)).slice(0, 6);
}

async function isOptedOut(phone) {
  // Check both managers & cleaners for an opt-out flag on this phone
  let opted = false;

  const { data: m } = await supabase
    .from('managers')
    .select('sms_opt_out_at')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if (m?.sms_opt_out_at) opted = true;

  const { data: c } = await supabase
    .from('cleaners')
    .select('sms_opt_out_at')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if (c?.sms_opt_out_at) opted = true;

  return opted;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { role, subject_id, name, phone: rawPhone, consent } = req.body || {};
    if (!role || !['manager', 'cleaner'].includes(role)) {
      return res.status(400).json({ error: 'invalid role' });
    }
    if (!rawPhone) return res.status(400).json({ error: 'phone required' });
    if (!consent)  return res.status(400).json({ error: 'consent required' });

    const phone = e164(rawPhone);
    if (!/^\+\d{8,15}$/.test(phone)) {
      return res.status(400).json({ error: 'invalid phone format' });
    }

    // STOP/opt-out guard
    if (await isOptedOut(phone)) {
      const sender = process.env.TWILIO_FROM_NUMBER || '(your TurnQA number)';
      return res.status(400).json({
        error: 'opted_out',
        message: `This number has opted out of SMS. Text START to ${sender} to re-subscribe, then try again.`
      });
    }

    // Ensure subject record exists and phone is saved (admin client bypasses RLS)
    const table = role === 'manager' ? 'managers' : 'cleaners';
    let sid = subject_id;

    if (!sid) {
      const { data, error } = await supabase
        .from(table)
        .insert({ name: name || role, phone })
        .select('id')
        .single();
      if (error) throw error;
      sid = data.id;
    } else {
      const { error: upErr } = await supabase
        .from(table)
        .update({ phone })
        .eq('id', sid);
      if (upErr) throw upErr;
    }

    // Create OTP row (10 min expiry)
    const code = randCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: iErr } = await supabase
      .from('phone_otps')
      .insert({ role, subject_id: sid, phone, code, expires_at: expires });
    if (iErr) throw iErr;

    // Send via Twilio
    const sidEnv = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const tokEnv = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    const msid   = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
    const from   = (process.env.TWILIO_FROM_NUMBER || '').trim();

    if (!sidEnv || !tokEnv || (!msid && !from)) {
      return res.status(500).json({
        error: 'Twilio not configured (set ACCOUNT_SID, AUTH_TOKEN, and one of MESSAGING_SERVICE_SID or FROM_NUMBER).'
      });
    }

    const { default: twilio } = await import('twilio');
    const client = twilio(sidEnv, tokEnv);

    const body = `TurnQA code: ${code}. Reply STOP to opt out, HELP for help.`;
    const payload = msid
      ? { to: phone, body, messagingServiceSid: msid }
      : { to: phone, body, from };

    const msg = await client.messages.create(payload);

    return res.status(200).json({ ok: true, subject_id: sid, sms: { sid: msg.sid } });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
