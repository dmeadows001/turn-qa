// pages/api/list-my-properties.js
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// assumes a join table: property_cleaners(property_id uuid, cleaner_id uuid)
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const cleaner_id = (req.query.cleaner_id || '').toString().trim();
    if (!cleaner_id) {
      return res.status(400).json({ error: 'cleaner_id required' });
    }

    const supa = supabaseAdmin();

    const { data, error } = await supa
      .from('property_cleaners')
      .select('property_id, properties:property_id ( id, name )')
      .eq('cleaner_id', cleaner_id);

    if (error) throw error;

    // map to flat list, de-dupe just in case
    const rows = Array.from(
      new Map(
        (data || [])
          .map(r => r.properties)
          .filter(Boolean)
          .map(p => [p.id, p]) // key by id
      ).values()
    );

    return res.status(200).json({ rows });
  } catch (e) {
    console.error('list-my-properties error', e);
    return res.status(500).json({ error: e.message || 'list-my-properties failed' });
  }
}
