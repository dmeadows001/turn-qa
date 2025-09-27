// pages/api/list-my-properties.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// assumes a join table: property_cleaners(property_id uuid, cleaner_id uuid)
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const cleaner_id = (req.query.cleaner_id || '').toString().trim();
    if (!cleaner_id) return res.status(400).json({ error: 'cleaner_id required' });

    const { data, error } = await supa
      .from('property_cleaners')
      .select('properties:property_id ( id, name )')
      .eq('cleaner_id', cleaner_id);
    if (error) throw error;

    const rows = (data || [])
      .map(r => r.properties)
      .filter(Boolean);

    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: e.message || 'list-my-properties failed' });
  }
}
