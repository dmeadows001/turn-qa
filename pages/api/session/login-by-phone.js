// pages/api/session/login-by-phone.js
import { createClient } from '@supabase/supabase-js';
import { makeCleanerSession } from '../../../lib/session';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function normPhone(raw = '') {
  const only = (raw || '').replace(/[^\d+]/g, '');
  if (!only) return '';
  if (only.startsWith('+')) return only;
  if (/^\d{10}$/.test(only)) return `+1${only}`;
  return `+${only}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const phone = normPhone((req.body?.phone || '').toString());
    if (!phone) return res.status(400).json({ error: 'phone required' });

    // Must exist as a cleaner
    const { data: cl, error } = await supa
      .from('cleaners')
      .select('id, phone')
      .eq('phone', phone)
      .maybeSingle();
    if (error) throw error;
    if (!cl?.id) return res.status(404).json({ error: 'cleaner not found' });

    const { cookie, payload } = makeCleanerSession({ cleaner_id: cl.id, phone: cl.phone });
    res.setHeader('Set-Cookie', cookie);
    return res.json({ ok: true, cleaner_id: cl.id, phone: cl.phone, session: { sub: payload.sub, exp: payload.exp } });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'login-by-phone failed' });
  }
}
