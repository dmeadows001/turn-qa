// pages/api/list-turn-photos.js
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    const id = (req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Get photos + optional shot meta
    const { data, error } = await supabaseAdmin
      .from('turn_photos')
      .select(`
        id,
        turn_id,
        shot_id,
        storage_path,
        width,
        height,
        created_at,
        template_shots!left ( area_key, label )
      `)
      .eq('turn_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Sign each path
    const out = [];
    for (const row of (data || [])) {
      const path = row.storage_path;
      if (!path) continue;
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from('photos')
        .createSignedUrl(path, 60 * 10); // 10 minutes
      if (signErr) continue;

      out.push({
        id: row.id,
        path,
        width: row.width,
        height: row.height,
        created_at: row.created_at,
        area_key: row.template_shots?.area_key || null,
        label: row.template_shots?.label || null,
        signedUrl: signed?.signedUrl || null
      });
    }

    res.status(200).json({ photos: out });
  } catch (e) {
    console.error('list-turn-photos error:', e);
    res.status(500).json({ error: e.message || 'failed' });
  }
}
