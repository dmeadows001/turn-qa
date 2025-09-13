// pages/api/list-properties.js
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('properties')
      .select('id, name, address, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;

    // normalize fields so UI can rely on them
    const properties = (data || []).map(p => ({
      id: p.id,
      name: p.name || p.title || '(Unnamed)',
      address: p.address || '',
    }));

    res.status(200).json({ properties });
  } catch (e) {
    console.error('list-properties error:', e);
    res.status(500).json({ error: e.message || 'failed' });
  }
}
