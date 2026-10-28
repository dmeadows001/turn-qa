
// pages/api/sms/otp-verify.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { makeCleanerSession } from '@/lib/session';

const supabase = typeof _admin === 'function' ? _admin() : _admin;

function e164(s = '') {
  const digits = String(s || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  return `+${digits}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { phone, code } = req.body || {};

    if (!phone || !code) {
      return res.status(400).json({
        error: 'phone and code required',
        reason: 'missing_params',
      });
    }

    const normalizedPhone = e164(phone);

    if (!/^\+\d{8,15}$/.test(normalizedPhone)) {
      return res.status(400).json({
        error: 'Invalid phone number',
        reason: 'invalid_phone',
      });
    }

    // 1. Find the latest OTP for this phone.
    const { data: row, error: selErr } = await supabase
      .from('sms_otp')
      .select('code, expires_at')
      .eq('phone', normalizedPhone)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selErr) throw selErr;

    if (!row) {
      return res.status(400).json({
        error: 'No code found. Send a new one.',
        reason: 'no_code',
      });
    }

    // 2. Validate the verification code.
    if (String(row.code) !== String(code).trim()) {
      return res.status(400).json({
        error: 'Invalid code',
        reason: 'mismatch',
      });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        error: 'Code expired',
        reason: 'expired',
      });
    }

    // 3. Find the cleaner who owns the verified phone number.
    const { data: cleaner, error: cleanerErr } = await supabase
      .from('cleaners')
      .select('id, phone')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (cleanerErr) throw cleanerErr;

    if (!cleaner?.id) {
      return res.status(404).json({
        error: 'Cleaner account not found',
        reason: 'cleaner_not_found',
      });
    }

    // 4. Record SMS consent.
    const { error: consentErr } = await supabase
      .from('cleaners')
      .update({ sms_consent: true })
      .eq('id', cleaner.id);

    if (consentErr) throw consentErr;

    // 5. Prepare the authenticated cleaner session.
    const { cookie } = makeCleanerSession(
      {
        cleaner_id: cleaner.id,
        phone: cleaner.phone,
      },
      req
    );

    // 6. Remove the used OTP before issuing the session.
    const { error: deleteErr } = await supabase
      .from('sms_otp')
      .delete()
      .eq('phone', normalizedPhone);

    if (deleteErr) throw deleteErr;

    // 7. Issue the secure HTTP-only session cookie.
    res.setHeader('Set-Cookie', cookie);

    return res.status(200).json({
      ok: true,
      cleaner_id: cleaner.id,
    });
  } catch (e) {
    console.error('[sms/otp-verify]', e);

    return res.status(500).json({
      error: e?.message || 'unexpected error',
    });
  }
}
