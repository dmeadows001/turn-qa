// pages/api/list-turn-photos.js
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    const id = (req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Try `photos` first (your original table), then fall back to `turn_photos`.
    let rows = null;
    let err = null;

    // 1) photos (original)
    let r1 = await supabaseAdmin
      .from('photos')
      .select('id, turn_id, shot_id, area_key, url, storage_path, width, height, created_at')
      .eq('turn_id', id)
      .order('created_at', { ascending: true });

    if (r1.error) {
      err = r1.error;
    } else {
      rows = r1.data || [];
    }

    // 2) if table didn't exist or query failed hard, try `turn_photos`
    if ((!rows || rows.length === 0) && (err?.code === '42P01' || err?.message?.includes('relation "photos" does not exist'))) {
      const r2 = await supabaseAdmin
        .from('turn_photos')
        .select('id, turn_id, shot_id, area_key, url, storage_path, width, height, created_at')
        .eq('turn_id', id)
        .order('created_at', { ascending: true });

      if (r2.error) throw r2.error;
      rows = r2.data || [];
    } else if (err && !rows) {
      // real error in the primary attempt
      throw err;
    }

    // Sign each path (prefer storage_path, else url if it's a storage path)
    const out = [];
    for (const row of rows) {
      const rawPath = row.storage_path || row.url || '';
      if (!rawPath) continue;

      // If someone stored a full https URL, strip to bucket path after '/photos/'
      let path = rawPath;
      const idx = rawPath.indexOf('/photos/');
      if (rawPath.startsWith('http') && idx !== -1) {
        path = rawPath.substring(idx + '/photos/'.length);
      }

      // Create a 10-minute signed URL from the 'photos' bucket
      const { data: signed, error: signErr } = await supabaseAdmin
        .storage
        .from('photos')
        .createSignedUrl(path, 60 * 10);

      if (signErr) {
        // Skip signing failure, but continue others
        continue;
      }

      out.push({
        id: row.id,
        path,
        width: row.width,
        height: row.height,
        area_key: row.area_key || null,
        label: row.label || null,
        created_at: row.created_at,
        signedUrl: signed?.signedUrl || null
      });
    }

    res.status(200).json({ photos: out });
  } catch (e) {
    console.error('list-turn-photos error:', e);
    res.status(500).json({ error: e.message || 'failed' });
  }
}
