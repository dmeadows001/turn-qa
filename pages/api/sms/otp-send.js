// pages/api/sms/otp-verify.js
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { phone, code } = req.body || {};
    if (!phone || !code) {
      return res.status(400).json({ error: 'phone and code required', reason: 'missing_params' });
    }

    const normalizedPhone = e164(phone);
    if (!/^\+\d{8,15}$/.test(normalizedPhone)) {
      return res.status(400).json({ error: 'Invalid phone number', reason: 'invalid_phone' });
    }

    const submittedCode = String(code).trim();
    if (!/^\d{6}$/.test(submittedCode)) {
      return res.status(400).json({ error: 'Invalid code', reason: 'mismatch' });
    }

    // Match the table used by /api/sms/otp-send. Do not accept used or expired codes.
    const { data: otp, error: otpErr } = await supabase
      .from('phone_otps')
      .select('id, code, expires_at, used_at, subject_id')
      .eq('phone', normalizedPhone)
      .eq('role', 'cleaner')
      .maybeSingle();
    if (otpErr) throw otpErr;
    if (!otp) {
      return res.status(400).json({ error: 'No code found. Send a new one.', reason: 'no_code' });
    }
    if (otp.used_at) {
      return res.status(400).json({ error: 'Code already used. Send a new one.', reason: 'used' });
    }
    if (new Date(otp.expires_at).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Code expired. Send a new one.', reason: 'expired' });
    }
    if (String(otp.code) !== submittedCode) {
      return res.status(400).json({ error: 'Invalid code', reason: 'mismatch' });
    }

    // Verify that this phone belongs to an existing cleaner; do not create accounts here.
    const { data: cleaner, error: cleanerErr } = await supabase
      .from('cleaners')
      .select('id, phone')
      .eq('phone', normalizedPhone)
      .maybeSingle();
    if (cleanerErr) throw cleanerErr;
    if (!cleaner?.id || (otp.subject_id && otp.subject_id !== cleaner.id)) {
      return res.status(404).json({ error: 'Cleaner account not found', reason: 'cleaner_not_found' });
    }

    // Atomically claim the OTP, so concurrent requests cannot reuse it.
    const { data: claimed, error: claimErr } = await supabase
      .from('phone_otps')
      .update({ used_at: new Date().toISOString() })
      .eq('id', otp.id)
      .eq('phone', normalizedPhone)
      .eq('role', 'cleaner')
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('id')
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) {
      return res.status(400).json({ error: 'Code expired or already used. Send a new one.', reason: 'unavailable' });
    }

    const { error: consentErr } = await supabase
      .from('cleaners')
      .update({ sms_consent: true })
      .eq('id', cleaner.id);
    if (consentErr) throw consentErr;

    const { cookie } = makeCleanerSession({ cleaner_id: cleaner.id, phone: cleaner.phone }, req);
    res.setHeader('Set-Cookie', cookie);
    return res.status(200).json({ ok: true, cleaner_id: cleaner.id });
  } catch (e) {
    console.error('[sms/otp-verify]', e);
    return res.status(500).json({ error: e?.message || 'unexpected error' });
  }
}
