// pages/api/otp/verify.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow',['POST']); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const { role, subject_id, phone, code } = req.body || {};
    if (!role || !['manager','cleaner'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    if (!subject_id || !phone || !code) return res.status(400).json({ error: 'subject_id, phone, code required' });

    const { data: otp, error: oErr } = await supabase
      .from('phone_otps')
      .select('*')
      .eq('role', role)
      .eq('subject_id', subject_id)
      .eq('phone', phone)
      .is('used_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (oErr || !otp) return res.status(400).json({ error: 'code not found' });

    if (otp.code !== String(code)) return res.status(400).json({ error: 'invalid code' });
    if (new Date(otp.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'code expired' });

    // Mark OTP used
    await supabase.from('phone_otps').update({ used_at: new Date().toISOString() }).eq('id', otp.id);

    // Record consent + verification
    const table = role === 'manager' ? 'managers' : 'cleaners';
    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0] || req.socket?.remoteAddress || null;
    const { error: upErr } = await supabase
      .from(table)
      .update({
        phone,
        phone_verified_at: new Date().toISOString(),
        sms_consent: true,
        sms_consent_at: new Date().toISOString(),
        sms_consent_ip: ip,
        consent_text_snapshot: 'I agree to receive transactional SMS from TurnQA. Message & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.'
      })
      .eq('id', subject_id);
    if (upErr) throw upErr;

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
