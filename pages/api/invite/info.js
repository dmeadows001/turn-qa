// pages/api/invite/info.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });

    // Load invite → join cleaner + property for name/phone
    const { data, error } = await supabase
      .from('cleaner_invites')
      .select(`
        id, created_at,
        cleaner_id, property_id,
        cleaner:cleaners ( phone, name ),
        property:properties ( name )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Invite not found' });

    const phone = data?.cleaner?.phone || '';
    const name  = data?.cleaner?.name  || '';
    const property_name = data?.property?.name || '';

    res.json({ ok: true, invite_id: id, phone, name, property_name });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
