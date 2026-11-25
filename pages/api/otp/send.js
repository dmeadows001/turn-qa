// pages/api/otp/send.js
import { randomInt } from 'crypto';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supabase = typeof _admin === 'function' ? _admin() : _admin;

function e164(raw) {
  if (typeof raw !== 'string') return '';
  const value = raw.trim().replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(value)) return `+1${value}`;
  if (/^\d{11}$/.test(value) && value.startsWith('1')) return `+${value}`;
  return value;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { role, phone: rawPhone, consent } = req.body || {};
    if (role !== 'cleaner') {
      return res.status(400).json({ error: 'Use the dedicated manager verification page for manager accounts.' });
    }
    if (consent !== true) return res.status(400).json({ error: 'SMS consent is required.' });
    const phone = e164(rawPhone);
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }
    const { data: cleaner, error: cleanerError } = await supabase
      .from('cleaners').select('id, sms_opt_out_at').eq('phone', phone).maybeSingle();
    if (cleanerError) throw cleanerError;
    if (!cleaner) return res.status(404).json({ error: 'No cleaner account found. Contact your property manager.' });
    const { data: managers, error: managerError } = await supabase
      .from('managers').select('id').eq('phone', phone).not('sms_opt_out_at', 'is', null).limit(1);
    if (managerError) throw managerError;
    if (cleaner.sms_opt_out_at || managers?.length) {
      const sender = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_FROM || '(your TurnQA number)';
      const message = `This number has opted out of SMS. Text START to ${sender} to re-subscribe, then try again.`;
      return res.status(400).json({ error: message, reason: 'opted_out', message });
    }
    const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    const service = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
    const from = (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_FROM || '').trim();
    if (!sid || !token || (!service && !from)) {
      return res.status(500).json({ error: 'SMS service is not configured.' });
    }
    const code = String(randomInt(100000, 1000000));
    const { data: result, error: reserveError } = await supabase.rpc('reserve_phone_otp_atomic', {
      p_role: 'cleaner', p_subject_id: cleaner.id, p_phone: phone, p_code: code,
    });
    if (reserveError) throw reserveError;
    if (result === 'cooldown') return res.status(429).json({ error: 'Please wait 60 seconds between code requests.' });
    if (result === 'rate_limited') return res.status(429).json({ error: 'Too many code requests. Please try again later.' });
    if (result !== 'reserved') return res.status(400).json({ error: 'Could not reserve a verification code.' });
    const { default: twilio } = await import('twilio');
    const client = twilio(sid, token);
    const body = `TurnQA code: ${code}. Reply STOP to opt out, HELP for help.`;
    await client.messages.create(service ? { to: phone, body, messagingServiceSid: service } : { to: phone, body, from });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[otp/send] request failed', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'Could not send a verification code. Please try again later.' });
  }
}
