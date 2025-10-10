// pages/api/turns/[id]/photos.js
// GET /api/turns/:id/photos  -> normalized existing photos for a turn
// Shape: { items: [{ path, shot_id, area_key, width, height, filename, needs_fix, manager_notes }] }

import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
const supa = typeof _admin === 'function' ? _admin() : _admin;

function pickPath(row) {
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

    // Try newer table first
    {
      const { data, error } = await supa
        .from('turn_photos')
        .select('id, shot_id, area_key, storage_path, path, photo_path, url, width, height, created_at, needs_fix, manager_notes')
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
            needs_fix: !!r.needs_fix,
            manager_notes: r.manager_notes || null,
          });
        });
      }
    }

    // Fallback to legacy table if nothing found
    if (items.length === 0) {
      const { data, error } = await supa
        .from('photos')
        .select('id, area_key, storage_path, path, photo_path, url, width, height, created_at, needs_fix, manager_notes')
        .eq('turn_id', id)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        data.forEach(r => {
          const path = pickPath(r);
          if (!path) return;
          items.push({
            path,
            shot_id: null,
            area_key: r.area_key || null,
            width: r.width || null,
            height: r.height || null,
            filename: path.split('/').pop() || 'photo.jpg',
            needs_fix: !!r.needs_fix,
            manager_notes: r.manager_notes || null,
          });
        });
      }
    }

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed to load turn photos' });
  }
}
