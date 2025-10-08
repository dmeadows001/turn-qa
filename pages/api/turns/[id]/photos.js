// pages/api/turns/[id]/photos.js
// GET /api/turns/:id/photos  -> returns existing photos for a turn
//
// Normalized shape:
// { items: [{ path, shot_id, area_key, width, height, filename }] }

import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

function pickPath(row) {
  // tolerate different column names across schemas
  return row.storage_path || row.path || row.photo_path || row.url || row.file || null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = (req.query.id || '').toString().trim();
    if (!id) return res.status(400).json({ error: 'missing id' });

    const items = [];

    // --- Try the "turn_photos" table (newer)
    {
      const { data, error } = await supa
        .from('turn_photos')
        .select('shot_id, area_key, storage_path, path, photo_path, url, width, height, created_at')
        .eq('turn_id', id)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        data.forEach(r => {
          const path = pickPath(r);
          if (!path) return;
          items.push({
            path,
            shot_id: r.shot_id || null,
            area_key: r.area_key || null,
            width: r.width || null,
            height: r.height || null,
            filename: path.split('/').pop() || 'photo.jpg',
          });
        });
      }
    }

    // --- If nothing found, try legacy "photos" table
    if (items.length === 0) {
      const { data, error } = await supa
        .from('photos')
        .select('area_key, storage_path, path, photo_path, url, width, height, created_at')
        .eq('turn_id', id)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        data.forEach(r => {
          const path = pickPath(r);
          if (!path) return;
          items.push({
            path,
            shot_id: null,               // legacy may not have a shot_id
            area_key: r.area_key || null,
            width: r.width || null,
            height: r.height || null,
            filename: path.split('/').pop() || 'photo.jpg',
          });
        });
      }
    }

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed to load turn photos' });
  }
}
