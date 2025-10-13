// pages/api/managers/verify-otp.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: true } };

// Simple E.164 validator
const E164 = /^\+[1-9]\d{6,14}$/;

// Best-effort US normalization: 10 digits -> +1XXXXXXXXXX, 11 starting with 1 -> +XXXXXXXXXXX
function normalizeToE164(raw: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (E164.test(s)) return s;

  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { user_id, code, consent } = (req.body || {}) as {
      user_id?: string;
      code?: string;
      consent?: boolean;
    };
    if (!user_id || !code) return res.status(400).json({ error: 'user_id and code required' });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Supabase service env vars missing' });

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1) Get latest pending verification for this user
    const { data: row, error: rowErr } = await supabase
      .from('manager_phone_verifications')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rowErr || !row) return res.status(400).json({ error: 'No pending verification found' });
    if ((row.attempts ?? 0) >= 5) return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    if (new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'Code expired. Request a new one.' });

    if (String(row.code) !== String(code)) {
      await supabase.from('manager_phone_verifications')
        .update({ attempts: (row.attempts ?? 0) + 1 })
        .eq('id', row.id);
      return res.status(400).json({ error: 'Invalid code.' });
    }

    // 2) Normalize phone and validate
    const e164 = normalizeToE164(row.phone || '');
    if (!e164) return res.status(400).json({ error: 'Invalid phone format. Please re-enter as +1XXXXXXXXXX.' });

    // 3) Build consent snapshot + IP
    const now = new Date().toISOString();
    const consentText = 'I agree to receive SMS alerts (STOP to opt out, HELP for help).';
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.socket?.remoteAddress ?? null);

    // 4) Update manager (or insert if missing)
    // Try update by user_id
    const { data: updated, error: upErr } = await supabase
      .from('managers')
      .update({
        phone: e164,
        phone_verified_at: now,
        sms_consent: !!consent,
        sms_consent_at: consent ? now : null,
        sms_consent_ip: ip ? (ip as any) : null,
        consent_text_snapshot: consent ? consentText : null,
      })
      .eq('user_id', user_id)
      .select('id') // return something so we can see if row existed
      .maybeSingle();

    if (upErr) return res.status(500).json({ error: upErr.message });

    // If no row was updated (manager not created yet), insert one
    if (!updated) {
      const { error: insErr } = await supabase.from('managers').insert({
        user_id,
        email: null,            // optional: you can set from auth profile elsewhere
        name: null,
        org_id: null,           // if you associate org on signup, set it here
        phone: e164,
        phone_verified_at: now,
        sms_consent: !!consent,
        sms_consent_at: consent ? now : null,
        sms_consent_ip: ip ? (ip as any) : null,
        consent_text_snapshot: consent ? consentText : null,
        created_at: now,
      });
      if (insErr) return res.status(500).json({ error: insErr.message });
    }

    // 5) OTP consumed — delete it
    await supabase.from('manager_phone_verifications').delete().eq('id', row.id);

    return res.status(200).json({ ok: true, phone: e164, consent: !!consent, verified_at: now });
  } catch (err: any) {
    console.error('[verify-otp] error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
