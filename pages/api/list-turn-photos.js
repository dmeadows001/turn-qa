// pages/api/list-turn-photos.js
import { supabaseAdmin } from '../../lib/supabase';

// Try to turn a full URL or a stored path into a bucket-relative path
function toBucketPath(raw) {
  if (!raw) return null;

  // If you stored just "turns/<id>/<file>.jpg" or "photos/turns/<id>/...":
  if (!raw.startsWith('http')) {
    return raw.startsWith('photos/') ? raw.slice('photos/'.length) : raw;
  }

  // If somehow a full URL was stored, try to strip to ".../object/<bucket>/<path>"
  // Common patterns in Supabase signed URLs:
  //   .../storage/v1/object/sign/photos/<path>?token=...
  //   .../storage/v1/object/public/photos/<path>
  const signMarker = '/object/sign/photos/';
  const pubMarker  = '/object/public/photos/';
  const i1 = raw.indexOf(signMarker);
  const i2 = raw.indexOf(pubMarker);
  if (i1 !== -1) return raw.substring(i1 + signMarker.length).split('?')[0];
  if (i2 !== -1) return raw.substring(i2 + pubMarker.length).split('?')[0];

  // Fallback: we can’t sign arbitrary external URLs
  return null;
}

export default async function handler(req, res) {
  try {
    const id = (req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Select only columns we know exist in your table
    const { data, error } = await supabaseAdmin
      .from('photos')
      .select('id, turn_id, area_key, url, created_at')
      .eq('turn_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const out = [];
    for (const row of (data || [])) {
      const bucketPath = toBucketPath(row.url);
      if (!bucketPath) continue;

      const { data: signed, error: signErr } = await supabaseAdmin
        .storage
        .from('photos') // bucket name
        .createSignedUrl(bucketPath, 60 * 10); // 10 minutes

      if (signErr) continue;

      out.push({
        id: row.id,
        path: bucketPath,
        area_key: row.area_key || null,
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
