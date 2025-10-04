// pages/api/sms/otp-verify.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Handle both export styles (function returning a client vs direct client)
const supabase = typeof _admin === 'function' ? _admin() : _admin;

function e164(s = '') {
  const digits = String(s || '').replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : '+' + digits;
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

    const e = e164(phone);

    // Look up latest OTP for this phone
    const { data: row, error: selErr } = await supabase
      .from('sms_otp')
      .select('code, expires_at')
      .eq('phone', e)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!row) return res.status(400).json({ error: 'No code found. Send a new one.', reason: 'no_code' });

    if (String(row.code) !== String(code).trim()) {
      return res.status(400).json({ error: 'Invalid code', reason: 'mismatch' });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Code expired', reason: 'expired' });
    }

    // Mark consent on cleaners with this phone (admin client bypasses RLS)
    await supabase.from('cleaners').update({ sms_consent: true }).eq('phone', e);

    // Clean up OTP row
    await supabase.from('sms_otp').delete().eq('phone', e);

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
