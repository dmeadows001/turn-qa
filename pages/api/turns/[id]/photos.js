// pages/api/turns/[id]/photos.js
// GET /api/turns/:id/photos  -> returns existing photos for a turn
//
// Normalized shape:
// { items: [{ path, shot_id, area_key, width, height, filename, needs_fix, note }] }

import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

function pickPath(row) {
  // tolerate different column names across schemas
  return row.storage_path || row.path || row.photo_path || row.url || row.file || null;
}

// Normalize the manager note across possible column spellings
function pickNote(row) {
  return row.manager_note || row.manager_notes || row.note || null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = (req.query.id || '').toString().trim();
    const debug = (req.query.debug || '').toString() === '1';
    if (!id) return res.status(400).json({ error: 'missing id' });

    const items = [];
    const meta = {
      turn_id: id,
      tried: [],
      errors: [],
      turn_photos_count: 0,
      photos_count: 0,
    };

    // --- Try the "turn_photos" table (newer)
    meta.tried.push('turn_photos');
    {
      const { data, error } = await supa
        .from('turn_photos')
        .select(
          'id, shot_id, area_key, storage_path, path, photo_path, url, width, height, created_at, needs_fix, manager_note, manager_notes'
        )
        .eq('turn_id', id)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        meta.turn_photos_count = data.length;
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
            note: pickNote(r),
          });
        });
      } else if (error) {
        meta.errors.push(`turn_photos: ${error.message}`);
      }
    }

    // --- If nothing found, try legacy "photos" table
    if (items.length === 0) {
      meta.tried.push('photos');
      const { data, error } = await supa
        .from('photos')
        .select(
          'id, area_key, storage_path, path, photo_path, url, width, height, created_at, needs_fix, manager_note, manager_notes'
        )
        .eq('turn_id', id)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        meta.photos_count = data.length;
        data.forEach(r => {
          const path = pickPath(r);
          if (!path) return;
          items.push({
            path,
            shot_id: null, // legacy may not have a shot_id
            area_key: r.area_key || null,
            width: r.width || null,
            height: r.height || null,
            filename: path.split('/').pop() || 'photo.jpg',
            needs_fix: !!r.needs_fix,
            note: pickNote(r),
          });
        });
      } else if (error) {
        meta.errors.push(`photos: ${error.message}`);
      }
    }

    if (debug) return res.json({ items, meta });
    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed to load turn photos' });
  }
}
