// pages/api/otp/verify.js
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { makeCleanerSession } from '@/lib/session';

function normalizePhone(s = '') {
  const d = (s || '').replace(/[^\d+]/g, '');
  return d ? (d.startsWith('+') ? d : `+${d}`) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let { role, subject_id, phone, code } = req.body || {};
    if (!role || !['manager', 'cleaner'].includes(role)) {
      return res.status(400).json({ error: 'invalid role' });
    }
    if (!phone || !code) {
      return res.status(400).json({ error: 'phone and code required' });
    }

    const supabase = supabaseAdmin();
    const normPhone = normalizePhone(phone);

    // 1) Find latest unused OTP for this role/phone
    const { data: otp, error: oErr } = await supabase
      .from('phone_otps')
      .select('*')
      .eq('role', role)
      .eq('phone', normPhone)
      .is('used_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (oErr || !otp) return res.status(400).json({ error: 'code not found' });
    if (String(otp.code) !== String(code)) return res.status(400).json({ error: 'invalid code' });
    if (new Date(otp.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'code expired' });

    // Prefer subject_id from the OTP if client didn't pass one
    const sid = subject_id || otp.subject_id;
    if (!sid) return res.status(400).json({ error: 'missing subject_id' });

    // 2) Mark OTP used (best-effort)
    await supabase
      .from('phone_otps')
      .update({ used_at: new Date().toISOString() })
      .eq('id', otp.id);

    // 3) Record consent/verification on the correct table
    const table = role === 'manager' ? 'managers' : 'cleaners';
    const ip =
      (req.headers['x-forwarded-for'] || '').toString().split(',')[0] ||
      req.socket?.remoteAddress ||
      null;

    const { error: upErr } = await supabase
      .from(table)
      .update({
        phone: normPhone,
        phone_verified_at: new Date().toISOString(),
        sms_consent: true,
        sms_consent_at: new Date().toISOString(),
        sms_consent_ip: ip,
        consent_text_snapshot:
          'I agree to receive transactional SMS from TurnQA. Message & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.',
      })
      .eq('id', sid);

    if (upErr) throw upErr;

    // 4) Create cleaner session cookie so /capture sees them as logged in
    if (role === 'cleaner') {
      const { cookie } = makeCleanerSession({ cleaner_id: sid, phone: normPhone });
      res.setHeader('Set-Cookie', cookie);
    }

    return res.status(200).json({ ok: true, subject_id: sid });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
