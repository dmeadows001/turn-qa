// pages/api/list-turn-photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// In this repo supabaseAdmin is a factory function
const supa = typeof _admin === 'function' ? _admin() : _admin;

// If you keep your photos in a single bucket, set it here or via env:
//   NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET=photos
const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // 1) Get photos for this turn, including area_key.
    //    We coalesce: prefer turn_photos.area_key, otherwise template_shots.area_key (by shot_id).
    const { data: rows, error } = await supa
      .from('turn_photos')
      .select(`
        id,
        turn_id,
        shot_id,
        path,
        created_at,
        area_key,
        template_shots!inner(id, area_key)
      `)
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const list = Array.isArray(rows) ? rows : [];

    // 2) Normalize and sign each path.
    const out = [];
    for (const r of list) {
      // prefer tp.area_key, else ts.area_key
      const areaKey = r.area_key || r.template_shots?.area_key || '';

      const path = String(r.path || '').replace(/^\/+/, ''); // no leading slash
      let signedUrl = '';
      if (path) {
        try {
          const { data: s } = await supa.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
          signedUrl = s?.signedUrl || '';
        } catch {
          // non-fatal; leave signedUrl blank if it fails
        }
      }

      out.push({
        id: r.id,
        turn_id: r.turn_id,
        shot_id: r.shot_id,
        path,
        created_at: r.created_at,
        area_key: areaKey || '',       // <= THIS is what the page uses to group
        signedUrl,
      });
    }

    return res.json({ photos: out });
  } catch (e) {
    console.error('[list-turn-photos] error', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
