// pages/api/sms/otp-verify.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function normalizePhone(s = "") {
  const digits = (s || "").replace(/[^\d+]/g, "");
  if (!digits.startsWith("+")) return "+" + digits.replace(/^(\+)+/, "");
  return digits;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const { phone, code } = req.body || {};
    if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });

    const to = normalizePhone(phone);

    // fetch OTP
    const { data: row, error: selErr } = await supabase
      .from('sms_otp')
      .select('code, expires_at')
      .eq('phone', to)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!row) return res.status(400).json({ error: 'No code found. Send a new one.' });

    // check match + expiry
    const now = Date.now();
    if (row.code !== String(code)) {
      return res.status(400).json({ error: 'Invalid code' });
    }
    if (new Date(row.expires_at).getTime() < now) {
      return res.status(400).json({ error: 'Code expired' });
    }

    // Mark consent = true for any cleaner with this phone
    await supabase
      .from('cleaners')
      .update({ sms_consent: true })
      .eq('phone', to);

    // clean up
    await supabase.from('sms_otp').delete().eq('phone', to);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
