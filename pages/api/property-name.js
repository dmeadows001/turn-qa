// pages/api/property-name.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data, error } = await supabase
      .from('properties')
      .select('name')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    res.json({ name: data?.name || '' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
