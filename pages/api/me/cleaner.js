// pages/api/me/cleaner.js
import { createClient } from '@supabase/supabase-js';
import { readCleanerSession } from '../../../lib/session';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  try {
    const sess = readCleanerSession(req);
    if (!sess) return res.status(401).json({ error: 'not_authenticated' });

    // Optional: load cleaner details
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
