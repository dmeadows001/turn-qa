// pages/api/sms/otp-verify.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function e164(s = '') {
  const digits = String(s || '').replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : '+' + digits;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { phone, code } = req.body || {};
    if (!phone || !code) return res.status(400).json({ error: 'phone and code required', reason: 'missing_params' });

    const e = e164(phone);

    const { data: row, error: selErr } = await supabase
      .from('sms_otp')
      .select('code, expires_at')
      .eq('phone', e)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!row) return res.status(400).json({ error: 'No code found. Send a new one.', reason: 'no_code' });

    if (String(row.code) !== String(code).trim()) {
      return res.status(400).json({ error: 'Invalid code', reason: 'mismatch' });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Code expired', reason: 'expired' });
    }

    // Mark consent on cleaners with this phone
    await supabase.from('cleaners').update({ sms_consent: true }).eq('phone', e);

    // Clean up the OTP row
    await supabase.from('sms_otp').delete().eq('phone', e);

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
