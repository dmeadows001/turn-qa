// pages/api/turns/[id]/photos.js
// GET /api/turns/:id/photos[?debug=1]
// Normalized shape: { items: [{ path, shot_id, area_key, width, height, filename }] }

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

  const debug = req.query.debug != null;
  const meta = {
    turn_id: null,
    tried: [],
    errors: [],
    turn_photos_count: 0,
    photos_count: 0,
    sample_turn_photos_ids: [],
    sample_photos_ids: [],
    storage_bucket: null,
    storage_hits: 0,
    storage_like_pattern: null,
  };

  try {
    // --- normalize UUID from the dynamic route
    const id = (req.query.id || '').toString().trim();
    if (!id) return res.status(400).json({ error: 'missing id' });
    meta.turn_id = id;

    const items = [];

    // --- 1) turn_photos (defensive)
    meta.tried.push('turn_photos');
    try {
      // First try * to avoid column-missing errors
      let q = supa.from('turn_photos').select('*').eq('turn_id', id).order('created_at', { ascending: true });
      let { data, error } = await q;
      if (error) throw error;

      meta.turn_photos_count = (data || []).length;
      meta.sample_turn_photos_ids = (data || []).slice(0, 3).map(r => r?.id);

      if (Array.isArray(data) && data.length) {
        data.forEach(r => {
          const p = pickPath(r);
          if (!p) return;
          items.push({
            path: p,
            shot_id: r.shot_id || null,
            area_key: r.area_key || null,
            width: r.width || null,
            height: r.height || null,
            filename: (p.split('/').pop() || 'photo.jpg'),
          });
        });
      }
    } catch (e) {
      meta.errors.push({ where: 'turn_photos', message: e?.message || String(e) });
    }

    // --- 2) legacy photos (only if still empty)
    if (items.length === 0) {
      meta.tried.push('photos');
      try {
        let { data, error } = await supa
          .from('photos')
          .select('*')
          .eq('turn_id', id)
          .order('created_at', { ascending: true });

        if (error) throw error;

        meta.photos_count = (data || []).length;
        meta.sample_photos_ids = (data || []).slice(0, 3).map(r => r?.id);

        if (Array.isArray(data) && data.length) {
          data.forEach(r => {
            const p = pickPath(r);
            if (!p) return;
            items.push({
              path: p,
              shot_id: r.shot_id || null, // legacy may not have a shot_id
              area_key: r.area_key || null,
              width: r.width || null,
              height: r.height || null,
              filename: (p.split('/').pop() || 'photo.jpg'),
            });
          });
        }
      } catch (e) {
        meta.errors.push({ where: 'photos', message: e?.message || String(e) });
      }
    }

    // --- 3) Storage prefix probe (only when still empty + debug)
    if (items.length === 0 && debug) {
      try {
        meta.tried.push('storage.objects');
        // If you’re using a non-default bucket, set it in env; otherwise default
        const bucket = process.env.NEXT_PUBLIC_TURNQA_BUCKET || 'turnqa';
        meta.storage_bucket = bucket;

        // Guess a common prefix
        const prefix = `turns/${id}/`;
        meta.storage_like_pattern = prefix + '%';

        const { data: objs, error: sErr } = await supa.storage.from(bucket).list(`turns/${id}`, { limit: 100 });
        if (!sErr && Array.isArray(objs)) {
          meta.storage_hits = objs.length;
          // NOTE: listing returns object names only; we still return empty items because
          // we don’t know exact column mapping back to DB. This is just a sanity probe.
        }
      } catch (e) {
        meta.errors.push({ where: 'storage', message: e?.message || String(e) });
      }
    }

    // Final response
    if (debug) return res.json({ items, meta });
    return res.json({ items });
  } catch (e) {
    const payload = { error: e.message || 'failed to load turn photos' };
    if (debug) payload.meta = meta;
    return res.status(500).json(payload);
  }
}
