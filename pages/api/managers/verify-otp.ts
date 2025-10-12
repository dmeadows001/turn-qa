import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // service role
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { user_id, code, consent } = req.body as { user_id?: string; code?: string; consent?: boolean };
    if (!user_id || !code) return res.status(400).json({ error: 'user_id and code required' });

    const { data: row, error } = await supabase
      .from('manager_phone_verifications')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !row) return res.status(400).json({ error: 'No pending verification found.' });
    if ((row.attempts ?? 0) >= 5) return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    if (new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'Code expired. Request a new one.' });

    if (row.code !== code) {
      await supabase.from('manager_phone_verifications').update({ attempts: (row.attempts ?? 0) + 1 }).eq('id', row.id);
      return res.status(400).json({ error: 'Invalid code.' });
    }

    const { error: upErr } = await supabase
      .from('managers')
      .update({
        phone: row.phone,
        sms_consent: !!consent,
        sms_consent_at: consent ? new Date().toISOString() : null,
        phone_verified_at: new Date().toISOString()
      })
      .eq('user_id', user_id);

    if (upErr) return res.status(500).json({ error: upErr.message });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('verify-otp error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
