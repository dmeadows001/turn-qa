// pages/api/list-turn-photos.js
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// ---------- Signing helpers ----------
async function trySign(supa, bucket, objectPath, expires = 600) {
  if (!bucket || !objectPath) return null;
  try {
    const { data, error } = await supa.storage.from(bucket).createSignedUrl(objectPath, expires);
    if (error) return null;
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}

/**
 * Sign a storage path that might be in different formats:
 *  - Already a full URL -> return as-is
 *  - "bucket/dir/file.jpg" -> use bucket=first segment
 *  - "dir/file.jpg" (no bucket) -> try candidate buckets
 */
async function signUnknownPath(supa, fullPath, { candidates = [] } = {}) {
  if (!fullPath || typeof fullPath !== 'string') return null;

  const trimmed = fullPath.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed; // already a URL

  const clean = trimmed.replace(/^\/+/, '');
  const parts = clean.split('/');
  let url = null;

  // A. If first segment looks like a bucket, try it
  if (parts.length > 1) {
    const bucket = parts[0];
    const objectPath = parts.slice(1).join('/');
    url = await trySign(supa, bucket, objectPath);
    if (url) return url;
  }

  // B. Try candidate buckets with the whole path as objectPath
  const envBucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET;
  const guesses = Array.from(
    new Set([envBucket, ...candidates, 'turn_photos', 'photos', 'public', 'images', 'assets'].filter(Boolean))
  );

  for (const b of guesses) {
    url = await trySign(supa, b, clean);
    if (url) return url;
  }

  // C. Nothing worked
  return null;
}

// ---------- Tolerant SELECT ----------
async function tolerantSelect(supa, { table, turnId, orderCol = 'created_at' }) {
  const variants = [
    { cols: 'id, turn_id, area_key, shot_id, storage_path, created_at', pathOf: r => r.storage_path },
    { cols: 'id, turn_id, area_key, shot_id, path, created_at',          pathOf: r => r.path },
    { cols: 'id, turn_id, area_key, shot_id, photo_path, created_at',    pathOf: r => r.photo_path },
    { cols: 'id, turn_id, area_key, shot_id, url, created_at',           pathOf: r => r.url },
    { cols: 'id, turn_id, area_key, shot_id, file, created_at',          pathOf: r => r.file },
    { cols: 'id, turn_id, area_key, shot_id, created_at',                pathOf: () => '' }, // last resort
  ];

  for (const v of variants) {
    try {
      const { data, error } = await supa
        .from(table)
        .select(v.cols)
        .eq('turn_id', turnId)
        .order(orderCol, { ascending: true });

      if (error) {
        const msg = (error.message || '').toLowerCase();
        // Only keep trying if it's a column-missing style error
        if (/(column|does not exist|unknown column)/i.test(msg)) continue;
        throw error;
      }

      return (data || []).map(r => ({
        id: r.id,
        turn_id: r.turn_id,
        area_key: r.area_key || '',
        shot_id: r.shot_id || null,
        created_at: r.created_at,
        path_like: v.pathOf(r) || '',
      }));
    } catch (e) {
      const msg = (e.message || '').toLowerCase();
      if (/(column|does not exist|unknown column)/i.test(msg)) continue;
      throw e;
    }
  }
  return [];
}

export default async function handler(req, res) {
  try {
    const turnId = (req.query.id || '').toString().trim();
    const debug = req.query.debug === '1';
    if (!turnId) return res.status(400).json({ error: 'id (turnId) is required' });

    // Use the service-role singleton (server-only, bypasses RLS for this trusted route)
    const supa = supabaseAdmin();

    // 1) Prefer new table
    let rows = await tolerantSelect(supa, { table: 'turn_photos', turnId });

    // 2) Fallback to legacy if empty
    if (!rows.length) rows = await tolerantSelect(supa, { table: 'photos', turnId });

    // 3) Sign URLs (robust to missing bucket names)
    const signed = [];
    for (const r of rows) {
      const signedUrl = await signUnknownPath(supa, r.path_like, { candidates: ['turns', 'uploads'] });
      signed.push({
        id: r.id,
        turn_id: r.turn_id,
        area_key: r.area_key || '',
        path: r.path_like || '',
        created_at: r.created_at,
        signedUrl: signedUrl || '',
      });
    }

    if (debug) {
      return res.json({
        photos: signed,
        note:
          'debug=1 includes raw path and signedUrl. If signedUrl is empty, the stored path is missing a bucket name and none of the guessed buckets worked.',
        guessedBuckets: [
          'env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET',
          'turn_photos',
          'photos',
          'public',
          'images',
          'assets',
          'turns',
          'uploads',
        ],
      });
    }

    return res.json({ photos: signed });
  } catch (e) {
    console.error('list-turn-photos error', e);
    return res.status(500).json({ error: e.message || 'list-turn-photos failed' });
  }
}
