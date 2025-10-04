// pages/api/cleaner/properties.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Handle either export style from supabaseAdmin (factory or instance)
const supabase = typeof _admin === 'function' ? _admin() : _admin;

function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits ? (digits.startsWith('+') ? digits : `+${digits}`) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { phone } = req.body || {};
    const e164 = normalizePhone(phone || '');
    if (!e164) return res.status(400).json({ error: 'phone is required' });

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
      .select('property_id, properties:properties(name)')
      .eq('cleaner_id', cleaner.id);
    if (pErr) throw pErr;

    const properties = (rows || []).map(r => ({
      id: r.property_id,
      name: r.properties?.name || 'Untitled',
    }));

    return res.json({ cleaner, properties });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
