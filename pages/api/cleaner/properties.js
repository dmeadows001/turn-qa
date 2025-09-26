// pages/api/cleaner/properties.js
import { createClient } from '@supabase/supabase-js';

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return createClient(url, key, { auth: { persistSession: false } });
}
function normalizePhone(s=''){ const d=(s||'').replace(/[^\d+]/g,''); return d?(d.startsWith('+')?d:`+${d}`):''; }

export default async function handler(req, res) {
  const supa = admin();
  try {
    const phone = normalizePhone((req.method === 'POST' ? req.body?.phone : req.query?.phone) || '');
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    // find cleaner
    const { data: cleaner } = await supa
      .from('cleaners')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    let properties = [];

    if (cleaner?.id) {
      // preferred: assignments
      const { data: assigned } = await supa
        .from('property_cleaners')
        .select('property_id, properties:properties(name)')
        .eq('cleaner_id', cleaner.id);
      properties = (assigned || []).map(r => ({ id: r.property_id, name: r.properties?.name || r.property_id }));
    }

    if (properties.length === 0) {
      // fallback: any invites we can see for this phone
      const { data: invited } = await supa
        .from('cleaner_invites')
        .select('property_id, properties:properties(name)')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(10);
      properties = (invited || []).map(r => ({ id: r.property_id, name: r.properties?.name || r.property_id }));
    }

    return res.status(200).json({ cleaner, properties });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'lookup failed' });
  }
}
