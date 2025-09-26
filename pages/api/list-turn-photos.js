// pages/api/list-turn-photos.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server-side secret
);

// Sign "bucket/path/in/bucket.jpg" to a temporary URL
async function signPath(fullPath, expires = 600) {
  try {
    if (!fullPath || typeof fullPath !== 'string' || !fullPath.includes('/')) return null;
    const [bucket, ...rest] = fullPath.split('/');
    const pathInBucket = rest.join('/');
    const { data, error } = await supa.storage.from(bucket).createSignedUrl(pathInBucket, expires);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}

async function selectTurnPhotos(turnId) {
  // Try new table with full set of columns
  let { data, error } = await supa
    .from('turn_photos')
    .select('id, turn_id, area_key, shot_id, path, created_at')
    .eq('turn_id', turnId)
    .order('created_at', { ascending: true });

  // If the schema doesn't have area_key/shot_id yet, fall back gracefully
  if (error && /area_key|shot_id/i.test(error.message || '')) {
    const resp = await supa
      .from('turn_photos')
      .select('id, turn_id, path, created_at')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (resp.error) throw resp.error;
    data = (resp.data || []).map(r => ({ ...r, area_key: '', shot_id: null }));
  } else if (error) {
    throw error;
  }

  return data || [];
}

async function selectLegacyPhotos(turnId) {
  // Legacy table (might also lack area_key)
  let { data, error } = await supa
    .from('photos')
    .select('id, turn_id, area_key, path, created_at')
    .eq('turn_id', turnId)
    .order('created_at', { ascending: true });

  if (error && /area_key/i.test(error.message || '')) {
    const resp = await supa
      .from('photos')
      .select('id, turn_id, path, created_at')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (resp.error) throw resp.error;
    data = (resp.data || []).map(r => ({ ...r, area_key: '' }));
  } else if (error) {
    throw error;
  }

  return data || [];
}

export default async function handler(req, res) {
  try {
    const turnId = (req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'id (turnId) is required' });

    // 1) Prefer new table
    let rows = await selectTurnPhotos(turnId);

    // 2) Fallback to legacy table if nothing found
    if (!rows.length) rows = await selectLegacyPhotos(turnId);

    // 3) Sign paths
    const photos = await Promise.all(
      (rows || []).map(async (r) => ({
        id: r.id,
        turn_id: r.turn_id,
        area_key: r.area_key || '',    // safe default
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
