// pages/api/cleaner/properties.js
import { createClient } from '@supabase/supabase-js';

function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const e164 = normalizePhone(phone);

    // 1) find cleaner by phone
    const { data: cleaner, error: cErr } = await supabase
      .from('cleaners')
      .select('id, name, phone')
      .eq('phone', e164)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!cleaner) return res.status(404).json({ error: 'Cleaner not found for that phone' });

    // 2) list properties this cleaner can work on
    const { data: rows, error: pErr } = await supabase
      .from('property_cleaners')
      .select('property_id, properties(name)')
      .eq('cleaner_id', cleaner.id);
    if (pErr) throw pErr;

    const properties = (rows || []).map(r => ({ id: r.property_id, name: r.properties?.name || 'Untitled' }));

    res.json({ cleaner, properties });
  } catch (e) {
    res.status(500).json({ error: e.message || 'server error' });
  }
}
