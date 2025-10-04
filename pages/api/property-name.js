// pages/api/property-name.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// works whether supabaseAdmin exports an instance or a factory
const supabase = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  try {
    const id = (req.query.id || '').toString().trim();
    if (!id) return res.status(400).json({ error: 'id required' });

    const { data, error } = await supabase
      .from('properties')
      .select('name')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'property not found' });

    return res.json({ name: data.name || '' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
