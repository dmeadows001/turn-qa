
// pages/api/properties/index.js
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('properties')
        .select('id,name,address,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ properties: data || [] });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const name = (body.name || '').trim();
      const address = (body.address || '').trim();
      if (!name) return res.status(400).json({ error: 'Name is required' });

      // 1) create property
      const { data: prop, error: pErr } = await supabaseAdmin
        .from('properties')
        .insert({ name, address })
        .select('id,name,address,created_at')
        .single();
      if (pErr) throw pErr;

      // 2) ensure it has an active template
      const { data: tpl, error: tErr } = await supabaseAdmin
        .from('property_templates')
        .insert({ property_id: prop.id, name: 'Default', is_active: true })
        .select('id,property_id')
        .single();
      if (tErr) throw tErr;

      return res.status(201).json({ property: prop, template: tpl });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('api/properties error:', e);
    res.status(500).json({ error: 'properties endpoint failed' });
  }
}
