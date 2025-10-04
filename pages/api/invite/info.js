// pages/api/invite/info.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Support either export style (factory vs instance)
const supabase = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  try {
    const id = (req.query.id || '').toString().trim();
    if (!id) return res.status(400).json({ error: 'id required' });

    // Invite → join cleaner + property (names/phone)
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

    res.json({
      ok: true,
      invite_id: id,
      phone: data?.cleaner?.phone || '',
      name: data?.cleaner?.name || '',
      property_name: data?.property?.name || ''
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'server error' });
  }
}
