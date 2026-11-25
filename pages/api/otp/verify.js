// pages/api/otp/verify.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { makeCleanerSession } from '@/lib/session';

const supabase = typeof _admin === 'function' ? _admin() : _admin;

function e164(raw = '') {
  const value = String(raw || '').trim().replace(/[^\d+]/g, '');
  if (!value) return '';
  if (value.startsWith('+')) return value;
  if (/^\d{10}$/.test(value)) return `+1${value}`;
  return `+${value}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { role, phone, code } = req.body || {};
    if (role !== 'cleaner') return res.status(400).json({ error: 'Invalid role' });
    const normalizedPhone = e164(phone);
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Enter a valid 6-digit code.' });
    }
    const { data, error } = await supabase.rpc('verify_phone_otp_atomic', {
      p_role: 'cleaner', p_phone: normalizedPhone, p_code: code.trim(),
    });
    if (error) throw error;
    const result = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (!result) throw new Error('Unexpected OTP verification response');
    const failures = {
      not_found: [400, 'No code found. Request a new code.'],
      already_used: [400, 'Code already used. Request a new code.'],
      expired: [400, 'Code expired. Request a new code.'],
      too_many_attempts: [429, 'Too many attempts. Request a new code.'],
      invalid_code: [400, 'Invalid code.'],
      account_not_found: [400, 'Unable to verify account. Request a new code.'],
    };
    if (result.result !== 'verified') {
      const failure = failures[result.result];
      if (!failure) throw new Error('Unknown OTP verification result');
      return res.status(failure[0]).json({ error: failure[1], reason: result.result });
    }
    if (!result.verified_subject_id) throw new Error('Missing verified account ID');
    const { data: cleaner, error: cleanerError } = await supabase
      .from('cleaners').select('id, phone, sms_opt_out_at')
      .eq('id', result.verified_subject_id).eq('phone', normalizedPhone).maybeSingle();
    if (cleanerError) throw cleanerError;
    if (!cleaner) return res.status(400).json({ error: 'Unable to verify account.' });
    if (cleaner.sms_opt_out_at) return res.status(400).json({ error: 'This number has opted out of SMS. Please re-subscribe and request a new code.' });
    const now = new Date().toISOString();
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') || req.socket?.remoteAddress || null;
    const { data: updated, error: updateError } = await supabase.from('cleaners').update({
      phone_verified_at: now,
      sms_consent: true,
      sms_consent_at: now,
      sms_consent_ip: ip,
      consent_text_snapshot: 'I agree to receive transactional SMS from TurnQA at this number. Message & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.',
    }).eq('id', cleaner.id).eq('phone', normalizedPhone).is('sms_opt_out_at', null).select('id').maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return res.status(400).json({ error: 'Account changed. Please request a new code.' });
    const { cookie } = makeCleanerSession({ cleaner_id: cleaner.id, phone: normalizedPhone }, req);
    res.setHeader('Set-Cookie', cookie);
    return res.status(200).json({ ok: true, subject_id: cleaner.id, cleaner_id: cleaner.id });
  } catch (err) {
    console.error('[otp/verify]', err);
    return res.status(500).json({ error: 'Verification failed. Please request a new code and try again.' });
  }
}
