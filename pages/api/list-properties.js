// pages/api/list-properties.js
import { supabaseClient } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    // You can add .eq('is_active', true) if you have that column
    const { data, error } = await supabaseClient
      .from('properties')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) throw error;
    res.status(200).json({ properties: data || [] });
  } catch (e) {
    console.error('list-properties error:', e);
    res.status(500).json({ error: e.message || 'failed' });
  }
}
