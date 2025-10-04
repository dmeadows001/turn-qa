// pages/api/property/assign-manager.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Reuse the admin client (service-role). Your supabaseAdmin can be either a
// function that returns a client or the client itself — handle both.
const supabase = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { property_id, manager_id } = req.body || {};
    if (!property_id || !manager_id) {
      return res.status(400).json({ error: 'property_id and manager_id are required' });
    }

    // Validate existence (clear 404s instead of silent failures)
    const [{ data: prop, error: pErr }, { data: mgr, error: mErr }] = await Promise.all([
      supabase.from('properties').select('id').eq('id', property_id).maybeSingle(),
      supabase.from('managers').select('id').eq('id', manager_id).maybeSingle(),
    ]);
    if (pErr) throw pErr;
    if (!prop) return res.status(404).json({ error: 'Property not found' });
    if (mErr) throw mErr;
    if (!mgr)  return res.status(404).json({ error: 'Manager not found' });

    // Assign the manager (service role bypasses RLS)
    const { error: upErr } = await supabase
      .from('properties')
      .update({ manager_id })
      .eq('id', property_id);
    if (upErr) throw upErr;

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unexpected error' });
  }
}
