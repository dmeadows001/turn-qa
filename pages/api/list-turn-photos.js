// pages/api/list-turn-photos.js
import { supabaseAdmin } from '../../lib/supabase';

// Helper: turn a stored path OR full https URL into a bucket-relative path
function toBucketPath(raw) {
  if (!raw) return null;
  if (raw.startsWith('http')) {
    // If it's a full URL, try to strip everything up to and including "/photos/"
    const marker = '/photos/';
    const i = raw.indexOf(marker);
    if (i !== -1) return raw.substring(i + marker.length);
    return null; // can't sign arbitrary external URLs
  }
  // If it already starts with "photos/" prefix, strip it
  if (raw.startsWith('photos/')) return raw.substring('photos/'.length);
  return raw; // assume it's already a relative path inside the bucket
}

export default async function handler(req, res) {
  try {
    const id = (req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Read from your existing table. (Use the one you actually have.)
    // Most of your setup used `photos`, not `turn_photos`.
    const { data, error } = await supabaseAdmin
      .from('photos')
      .select('id, turn_id, shot_id, area_key, url, storage_path, width, height, created_at')
      .eq('turn_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const out = [];
    for (const row of (data || [])) {
      // Prefer storage_path; fall back to url
      const bucketPath = toBucketPath(row.storage_path || row.url);
      if (!bucketPath) continue;

      const { data: signed, error: signErr } = await supabaseAdmin
        .storage
        .from('photos')                // bucket name: "photos"
        .createSignedUrl(bucketPath, 60 * 10); // 10 minutes

      if (signErr) continue;

      out.push({
        id: row.id,
        path: bucketPath,
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
