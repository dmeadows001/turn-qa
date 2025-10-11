// pages/api/turns/[id]/photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

// normalize any row from either table into a single item shape
function toItem(row) {
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
    id: row.id,
    shot_id: row.shot_id || row.template_shot_id || null,
    area_key: row.area_key || row.area || null,
    path,
    filename,
    width: row.width || null,
    height: row.height || null,
    created_at: row.created_at || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const turnId = String(req.query.id || '').trim();
    const debug = req.query.debug === '1' || req.query.debug === 'true';

    if (!turnId) return res.status(400).json({ error: 'missing id' });

    // Try new table first
    const items = [];
    const tried = [];

    tried.push('turn_photos');
    const t1 = await supa
      .from('turn_photos')
      .select(
        'id, turn_id, shot_id, area_key, storage_path, path, filename, width, height, created_at'
      )
      .eq('turn_id', turnId);

    if (!t1.error && Array.isArray(t1.data)) {
      for (const row of t1.data) {
        const it = toItem(row);
        if (it.path) items.push(it);
      }
    }

    // Fall back to legacy table if nothing found
    if (items.length === 0) {
      tried.push('photos');
      const t2 = await supa
        .from('photos')
        .select(
          'id, turn_id, shot_id, area_key, path, filename, width, height, created_at, url, file, photo_path, storage_path'
        )
        .eq('turn_id', turnId);

      if (!t2.error && Array.isArray(t2.data)) {
        for (const row of t2.data) {
          const it = toItem(row);
          if (it.path) items.push(it);
        }
      }
    }

    // We *could* consider listing storage directly when DB is empty,
    // but most flows insert DB rows on upload, so keep this simple/fast.

    return res.json({
      items,
      meta: {
        turn_id: turnId,
        tried,
        count: items.length,
        debug,
      },
    });
  } catch (e) {
    console.error('[api/turns/[id]/photos] error', e);
    return res.status(500).json({ error: e.message || 'list failed' });
  }
}
