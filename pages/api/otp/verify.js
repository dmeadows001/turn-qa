// pages/api/otp/verify.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { makeCleanerSession } from '@/lib/session';

function normalizePhone(s = '') {
  const digits = String(s || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  return `+${digits}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    const { role, phone, code } = req.body || {};

    if (!['manager', 'cleaner'].includes(role)) {
      return res.status(400).json({ error: 'invalid role' });
    }

    const normPhone = normalizePhone(phone);

    if (!/^\+\d{8,15}$/.test(normPhone) || !code) {
      return res.status(400).json({
        error: 'valid phone and code required',
      });
    }

    const supabase =
      typeof _admin === 'function' ? _admin() : _admin;

    // Find the latest unused OTP for this role and phone.
    const { data: otp, error: otpErr } = await supabase
      .from('phone_otps')
      .select('id, subject_id, code, expires_at')
      .eq('role', role)
      .eq('phone', normPhone)
      .is('used_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpErr) throw otpErr;

    if (!otp) {
      return res.status(400).json({ error: 'code not found' });
    }

    if (String(otp.code) !== String(code).trim()) {
      return res.status(400).json({ error: 'invalid code' });
    }

    if (
      !Number.isFinite(new Date(otp.expires_at).getTime()) ||
      new Date(otp.expires_at).getTime() <= Date.now()
    ) {
      return res.status(400).json({ error: 'code expired' });
    }

    // Never trust a subject_id supplied by the browser.
    const subjectId = otp.subject_id;

    if (!subjectId) {
      return res.status(400).json({
        error: 'verification account not found',
      });
    }

    const table = role === 'manager' ? 'managers' : 'cleaners';

    // Confirm the verified phone belongs to this account.
    const { data: account, error: accountErr } = await supabase
      .from(table)
      .select('id, phone')
      .eq('id', subjectId)
      .eq('phone', normPhone)
      .maybeSingle();

    if (accountErr) throw accountErr;

    if (!account) {
      return res.status(400).json({
        error: 'verification account mismatch',
      });
    }

    const now = new Date().toISOString();

    // Atomically claim this unused code using a conditional update.
    const { data: claimed, error: claimErr } = await supabase
      .from('phone_otps')
      .update({ used_at: now })
      .eq('id', otp.id)
      .is('used_at', null)
      .gt('expires_at', now)
      .select('id')
      .maybeSingle();

    if (claimErr) throw claimErr;

    if (!claimed) {
      return res.status(400).json({
        error: 'code already used or expired',
      });
    }

    // Record verification and SMS consent.
    const ip =
      String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() ||
      req.socket?.remoteAddress ||
      null;

    const { error: updateErr } = await supabase
      .from(table)
      .update({
        phone_verified_at: now,
        sms_consent: true,
        sms_consent_at: now,
        sms_consent_ip: ip,
        consent_text_snapshot:
          'I agree to receive transactional SMS from TurnQA. Message & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.',
      })
      .eq('id', account.id)
      .eq('phone', normPhone);

    if (updateErr) throw updateErr;

    // Preserve existing cleaner authentication.
    if (role === 'cleaner') {
      const { cookie } = makeCleanerSession(
        {
          cleaner_id: account.id,
          phone: normPhone,
        },
        req
      );

      res.setHeader('Set-Cookie', cookie);
    }

    return res.status(200).json({
      ok: true,
      subject_id: account.id,
    });
  } catch (e) {
    console.error('[otp/verify]', e);

    return res.status(500).json({
      error: 'Verification failed',
    });
  }
}
