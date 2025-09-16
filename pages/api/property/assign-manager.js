// pages/api/property/assign-manager.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') { 
    res.setHeader('Allow',['POST']); 
    return res.status(405).json({ error: 'Method not allowed' }); 
  }
  try {
    const { property_id, manager_id } = req.body || {};
    if (!property_id || !manager_id) {
      return res.status(400).json({ error: 'property_id and manager_id are required' });
    }

    // Optionally validate they exist
    const [{ data: prop, error: pErr }, { data: mgr, error: mErr }] = await Promise.all([
      supabase.from('properties').select('id').eq('id', property_id).single(),
      supabase.from('managers').select('id').eq('id', manager_id).single()
    ]);
    if (pErr || !prop) return res.status(404).json({ error: 'Property not found' });
    if (mErr || !mgr)  return res.status(404).json({ error: 'Manager not found' });

    const { error: upErr } = await supabase
      .from('properties')
      .update({ manager_id })
      .eq('id', property_id);
    if (upErr) throw upErr;

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
