// pages/api/turns/[id]/photos.js
// GET /api/turns/:id/photos  -> returns existing photos for a turn
//
// Normalized shape:
// { items: [{ path, shot_id, area_key, width, height, filename }] }
// Adds ?debug=1 to include meta about what paths were tried.

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

  const debug = String(req.query.debug || '') === '1';

  try {
    const id = (req.query.id || '').toString().trim();
    if (!id) return res.status(400).json({ error: 'missing id' });

    const items = [];
    const meta = {
      turn_id: id,
      tried: [],
      turn_photos_count: 0,
      photos_count: 0,
      sample_turn_photos_ids: [],
      sample_photos_ids: [],
      storage_bucket: null,
      storage_hits: 0,
      storage_like_pattern: null,
    };

    // --- 1) Try the "turn_photos" table (newer)
    meta.tried.push('turn_photos');
    {
      const { data, error } = await supa
        .from('turn_photos')
        .select('id, shot_id, area_key, storage_path, path, photo_path, url, width, height, created_at')
        .eq('turn_id', id)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data) && data.length) {
        meta.turn_photos_count = data.length;
        meta.sample_turn_photos_ids = data.slice(0, 3).map(r => r.id);
        data.forEach(r => {
          const path = pickPath(r);
          if (!path) return;
          items.push({
            path,
            shot_id: r.shot_id || null,
            area_key: r.area_key || null,
            width: r.width || null,
            height: r.height || null,
            filename: (path.split('/').pop() || 'photo.jpg')
          });
        });
      }
    }

    // --- 2) If nothing found, try legacy "photos" table
    if (items.length === 0) {
      meta.tried.push('photos');
      const { data, error } = await supa
        .from('photos')
        .select('id, area_key, storage_path, path, photo_path, url, width, height, created_at')
        .eq('turn_id', id)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data) && data.length) {
        meta.photos_count = data.length;
        meta.sample_photos_ids = data.slice(0, 3).map(r => r.id);
        data.forEach(r => {
          const path = pickPath(r);
          if (!path) return;
          items.push({
            path,
            shot_id: null,
            area_key: r.area_key || null,
            width: r.width || null,
            height: r.height || null,
            filename: (path.split('/').pop() || 'photo.jpg')
          });
        });
      }
    }

    // --- 3) Storage fallback: query storage.objects when DB is empty
    if (items.length === 0) {
      meta.tried.push('storage.objects');

      // Try likely bucket names. You can set NEXT_PUBLIC_SUPABASE_BUCKET to override.
      const candidates = [
        process.env.NEXT_PUBLIC_SUPABASE_BUCKET,
        'photos',
        'public',
        'images',
        'turns'
      ].filter(Boolean);

      // Two LIKE patterns: strict folder and lenient "contains id"
      const likePatterns = [
        `turns/${id}/%`, // common folder structure
        `%${id}%`,       // fallback: anywhere in name
      ];

      let found = [];
      let chosenBucket = null;
      let chosenPattern = null;

      for (const bucket of candidates) {
        for (const patt of likePatterns) {
          // Query storage.objects directly (service role can read it)
          const { data, error } = await supa
            .from('storage.objects')
            .select('name, bucket_id, metadata, created_at')
            .eq('bucket_id', bucket)
            .like('name', patt)
            .order('created_at', { ascending: true })
            .limit(500);

          if (!error && Array.isArray(data) && data.length) {
            found = data;
            chosenBucket = bucket;
            chosenPattern = patt;
            break;
          }
        }
        if (found.length) break;
      }

      meta.storage_bucket = chosenBucket;
      meta.storage_like_pattern = chosenPattern;
      meta.storage_hits = found.length;

      if (found.length) {
        found.forEach(obj => {
          const path = obj.name; // e.g., "turns/<turnId>/.../filename.jpg"
          items.push({
            path,
            shot_id: null,          // storage catalog doesn’t know this
            area_key: null,
            width: null,
            height: null,
            filename: (path.split('/').pop() || 'photo.jpg'),
          });
        });
      }
    }

    // Done
    if (debug) {
      return res.json({ items, meta });
    }
    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed to load turn photos' });
  }
}
