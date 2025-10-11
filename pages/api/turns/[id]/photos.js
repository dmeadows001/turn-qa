// pages/api/turns/[id]/photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

function asItem(row = {}) {
  // Try the most likely path fields in priority order
  const path =
    row.path ||
    row.storage_path ||
    row.photo_path ||
    row.url ||
    row.file ||
    null;

  const filename =
    row.filename ||
    (typeof path === 'string' ? path.split('/').pop() : null) ||
    null;

  return {
    id: row.id || null,
    path,
    filename,
    shot_id: row.shot_id || null,   // may be null in your schema; that's OK
    area_key: row.area_key || null, // often null in older rows
    width: row.width || null,
    height: row.height || null,
  };
}

export default async function handler(req, res) {
  try {
    const turnId = (req.query.id || '').toString().trim();
    const debug = String(req.query.debug || '') === '1';

    if (!turnId) {
      return res.status(400).json({ error: 'missing id' });
    }

    const meta = {
      turn_id: turnId,
      tried: [],
      count: 0,
      debug,
    };

    const items = [];
    const seen = new Set();

    // 1) Try new table: turn_photos
    meta.tried.push('turn_photos');
    let errTurnPhotos = null;
    try {
      const { data, error } = await supa
        .from('turn_photos')
        .select('*')
        .eq('turn_id', turnId);

      if (error) throw error;

      (data || []).forEach((row) => {
        const it = asItem(row);
        if (it.path && !seen.has(it.path)) {
          seen.add(it.path);
          items.push(it);
        }
      });
    } catch (e) {
      errTurnPhotos = e?.message || String(e);
    }

    // 2) Try legacy table: photos
    meta.tried.push('photos');
    let errPhotos = null;
    try {
      const { data, error } = await supa
        .from('photos')
        .select('*')
        .eq('turn_id', turnId);

      if (error) throw error;

      (data || []).forEach((row) => {
        const it = asItem(row);
        if (it.path && !seen.has(it.path)) {
          seen.add(it.path);
          items.push(it);
        }
      });
    } catch (e) {
      errPhotos = e?.message || String(e);
    }

    meta.count = items.length;
    if (debug) {
      if (errTurnPhotos) meta.error_turn_photos = errTurnPhotos;
      if (errPhotos) meta.error_photos = errPhotos;
    }

    return res.status(200).json({ items, meta });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[api/turns/[id]/photos] fatal', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
