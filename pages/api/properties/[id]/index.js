// pages/api/properties/[id]/index.js
import { supabaseAdmin } from '../../../../lib/supabase';

export default async function handler(req, res) {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    if (req.method === 'GET') {
      const { data: prop, error } = await supabaseAdmin
        .from('properties')
        .select('id,name,address,created_at')
        .eq('id', id)
        .single();
      if (error || !prop) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ property: prop });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('api/property detail error:', e);
    res.status(500).json({ error: 'property detail failed' });
  }
}

