// pages/api/me/cleaner.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { readCleanerSession } from '../../../lib/session';

// Support both export styles (function returning client vs direct client)
const supa = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  try {
    const sess = readCleanerSession(req);
    if (!sess) return res.status(401).json({ error: 'not_authenticated' });

    const { data: cl, error } = await supa
      .from('cleaners')
      .select('id, name, phone')
      .eq('id', sess.sub)
      .maybeSingle();

    if (error) throw error;
    if (!cl) return res.status(401).json({ error: 'not_authenticated' });

    return res.json({ ok: true, cleaner: cl });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'me/cleaner failed' });
  }
}
