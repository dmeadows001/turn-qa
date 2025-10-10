// pages/api/turns/[id]/photos.js
// GET /api/turns/:id/photos
// Normalized response:
// { items: [{ path, shot_id, area_key, width, height, filename }], meta: {...} }

import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
const supa = typeof _admin === 'function' ? _admin() : _admin;

function pickPath(row) {
  return row.storage_path || row.path || row.photo_path || row.url || row.file || null;
}

function normItem(r) {
  const path = pickPath(r);
  if (!path) return null;
  return {
    path,
    shot_id: r.shot_id ?? null,
    area_key: r.area_key ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
    filename: (path.split('/').pop() || 'photo.jpg'),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const turnId = String(req.query.id || '').trim();
    const debug = (req.query.debug === '1');
    if (!turnId) return res.status(400).json({ error: 'missing id' });

    let items = [];
    const meta = {
      turn_id: turnId,
      tried: [],
      turn_photos_count: 0,
      photos_count: 0,
      sample_turn_photos_ids: [],
      sample_photos_ids: [],
    };

    // --- Attempt 1: turn_photos (uuid or text)
    {
      meta.tried.push('turn_photos');
      // prefer wide select to tolerate column drift
      const sel = 'id, turn_id, shot_id, area_key, storage_path, path, photo_path, url, width, height, created_at';
      let { data, error } = await supa
        .from('turn_photos')
        .select(sel)
        .eq('turn_id', turnId)
        .order('created_at', { ascending: true });

      // If no rows, try a text cast (helps when turn_id is text in some envs)
      if (!error && Array.isArray(data) && data.length === 0) {
        const { data: d2, error: e2 } = await supa
          .from('turn_photos')
          .select(sel)
          .filter('turn_id', 'eq', turnId) // same, but keep separate branch for meta clarity
          .order('created_at', { ascending: true });
        if (!e2 && Array.isArray(d2) && d2.length) {
          data = d2;
          error = null;
        }
      }

      if (!error && Array.isArray(data)) {
        meta.turn_photos_count = data.length;
        meta.sample_turn_photos_ids = data.slice(0, 3).map(r => r.id);
        data.forEach(r => { const n = normItem(r); if (n) items.push(n); });
      }
    }

    // --- Attempt 2: legacy photos table
    if (items.length === 0) {
      meta.tried.push('photos');
      const sel = 'id, turn_id, area_key, storage_path, path, photo_path, url, width, height, created_at';
      let { data, error } = await supa
        .from('photos')
        .select(sel)
        .eq('turn_id', turnId)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data) && data.length === 0) {
        const { data: d2, error: e2 } = await supa
          .from('photos')
          .select(sel)
          .filter('turn_id', 'eq', turnId)
          .order('created_at', { ascending: true });
        if (!e2 && Array.isArray(d2) && d2.length) {
          data = d2;
          error = null;
        }
      }

      if (!error && Array.isArray(data)) {
        meta.photos_count = data.length;
        meta.sample_photos_ids = data.slice(0, 3).map(r => r.id);
        data.forEach(r => { const n = normItem(r); if (n) items.push(n); });
      }
    }

    // Optional raw dump for troubleshooting
    if (debug) {
      return res.status(200).json({ items, meta });
    }

    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed to load turn photos' });
  }
}
