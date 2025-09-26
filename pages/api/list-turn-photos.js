// pages/api/list-turn-photos.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server-side
);

// Helper: create a signed URL from a full storage path like "bucket/folder/file.jpg"
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

export default async function handler(req, res) {
  try {
    const turnId = (req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'id (turnId) is required' });

    // 1) Try the new table first
    let rows = [];
    {
      const { data, error } = await supa
        .from('turn_photos')
        .select('id, turn_id, area_key, path, created_at')
        .eq('turn_id', turnId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      rows = data || [];
    }

    // 2) Fallback to legacy table if nothing found
    if (!rows.length) {
      const { data, error } = await supa
        .from('photos') // legacy
        .select('id, turn_id, area_key, path, created_at')
        .eq('turn_id', turnId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      rows = data || [];
    }

    // 3) Sign each path
    const photos = await Promise.all(
      rows.map(async (r) => {
        const signedUrl = await signPath(r.path);
        return {
          id: r.id,
          turn_id: r.turn_id,
          area_key: r.area_key || '',
          path: r.path || '',
          created_at: r.created_at,
          signedUrl: signedUrl || '',
        };
      })
    );

    return res.json({ photos });
  } catch (e) {
    console.error('list-turn-photos error', e);
    return res.status(500).json({ error: e.message || 'list-turn-photos failed' });
  }
}
