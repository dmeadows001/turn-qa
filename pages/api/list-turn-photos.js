// pages/api/list-turn-photos.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server-side secret
);

// Try to sign "bucket/path/in/bucket.jpg" -> temporary URL
async function signPath(fullPath, expires = 600) {
  try {
    if (!fullPath || typeof fullPath !== 'string' || !fullPath.includes('/')) return null;
    const [bucket, ...rest] = fullPath.split('/');
    const objectPath = rest.join('/');
    const { data, error } = await supa.storage.from(bucket).createSignedUrl(objectPath, expires);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}

// Helper that tries multiple SELECT shapes until one works, then maps to a common shape
async function tolerantSelect({ table, turnId, orderCol = 'created_at' }) {
  // Ordered list of candidate column sets and how to map them to { path }
  const candidates = [
    { cols: 'id, turn_id, area_key, shot_id, path, created_at', pick: r => r.path },
    { cols: 'id, turn_id, area_key, shot_id, storage_path, created_at', pick: r => r.storage_path },
    { cols: 'id, turn_id, area_key, shot_id, photo_path, created_at', pick: r => r.photo_path },
    { cols: 'id, turn_id, area_key, shot_id, url, created_at', pick: r => r.url },
    { cols: 'id, turn_id, area_key, shot_id, file, created_at', pick: r => r.file },
    // Minimal fallback (no path-like column at all)
    { cols: 'id, turn_id, area_key, shot_id, created_at', pick: () => '' },
  ];

  for (const c of candidates) {
    try {
      const { data, error } = await supa
        .from(table)
        .select(c.cols)
        .eq('turn_id', turnId)
        .order(orderCol, { ascending: true });

      if (error) {
        // Retry with next candidate ONLY if it's a column error
        if (/(column|does not exist|unknown column)/i.test(error.message || '')) continue;
        throw error; // real error (permission, RLS, etc.)
      }

      const rows = (data || []).map(r => ({
        id: r.id,
        turn_id: r.turn_id,
        area_key: r.area_key || '',
        shot_id: r.shot_id || null,
        created_at: r.created_at,
        path: c.pick(r) || '',
      }));
      return rows;
    } catch (e) {
      // If it looks like a column-missing error, try next candidate
      if (/(column|does not exist|unknown column)/i.test(e.message || '')) continue;
      throw e; // surface other errors
    }
  }

  // If nothing worked, return empty
  return [];
}

export default async function handler(req, res) {
  try {
    const turnId = (req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'id (turnId) is required' });

    // 1) Prefer the new table
    let rows = await tolerantSelect({ table: 'turn_photos', turnId });

    // 2) Fall back to legacy 'photos' if empty
    if (!rows.length) {
      rows = await tolerantSelect({ table: 'photos', turnId });
    }

    // 3) Produce signed URLs (if path looks like bucket/path)
    const photos = await Promise.all(
      rows.map(async r => ({
        id: r.id,
        turn_id: r.turn_id,
        area_key: r.area_key || '',
        path: r.path || '',
        created_at: r.created_at,
        signedUrl: (await signPath(r.path)) || '',
      }))
    );

    return res.json({ photos });
  } catch (e) {
    console.error('list-turn-photos error', e);
    return res.status(500).json({ error: e.message || 'list-turn-photos failed' });
  }
}
