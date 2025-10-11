// pages/api/turns/[id]/photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

function filenameFromPath(p = '') {
  const s = String(p || '');
  return s.split('/').pop() || s;
}

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.id || '').trim();
    const debug = String(req.query.debug || '') === '1';
    if (!turnId) return res.status(400).json({ error: 'missing id' });

    const meta = { turn_id: turnId, tried: [], count: 0, debug };

    // ---------- 1) try turn_photos (new table) ----------
    {
      meta.tried.push('turn_photos');
      const { data, error } = await supa
        .from('turn_photos')
        .select(
          `
          id,
          turn_id,
          shot_id,
          area_key,
          width,
          height,
          bytes,
          filename,
          path,
          storage_path,
          created_at
        `
        )
        .eq('turn_id', turnId)
        .order('created_at', { ascending: true });

      if (error && debug) meta.error_turn_photos = error.message;

      if (Array.isArray(data) && data.length) {
        const items = data.map((r) => {
          const path = r.path || r.storage_path || '';
          return {
            id: r.id,
            shot_id: r.shot_id || null,
            area_key: r.area_key || null,
            width: r.width || null,
            height: r.height || null,
            bytes: r.bytes || null,
            path,
            filename: r.filename || filenameFromPath(path),
            created_at: r.created_at,
          };
        });
        meta.count = items.length;
        return res.json({ items, meta });
      }
    }

    // ---------- 2) try photos (legacy table) ----------
    {
      meta.tried.push('photos');
      const { data, error } = await supa
        .from('photos')
        .select(
          `
          id,
          turn_id,
          shot_id,
          area_key,
          width,
          height,
          bytes,
          filename,
          path,
          storage_path,
          created_at
        `
        )
        .eq('turn_id', turnId)
        .order('created_at', { ascending: true });

      if (error && debug) meta.error_photos = error.message;

      if (Array.isArray(data) && data.length) {
        const items = data.map((r) => {
          const path = r.path || r.storage_path || '';
          return {
            id: r.id,
            shot_id: r.shot_id || null,
            area_key: r.area_key || null,
            width: r.width || null,
            height: r.height || null,
            bytes: r.bytes || null,
            path,
            filename: r.filename || filenameFromPath(path),
            created_at: r.created_at,
          };
        });
        meta.count = items.length;
        return res.json({ items, meta });
      }
    }

    // ---------- 3) FINAL FALLBACK: list Supabase Storage ----------
    // Looks inside bucket "turns" under "turns/<turnId>/*"
    meta.tried.push('storage.objects');
    const bucket = 'turns';

    // First list the immediate children of the turn folder (could be files or subfolders like shot ids)
    const root = await supa.storage.from(bucket).list(`turns/${turnId}`, {
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (!root.error) {
      const items = [];

      // Helper to push file entries with full path
      const pushFiles = (entries, prefix) => {
        (entries || []).forEach((e) => {
          if (e && e.name && e.id && !e.metadata?.isDirectory) {
            const path = `${prefix}/${e.name}`;
            items.push({
              id: e.id,
              shot_id: null,
              area_key: null,
              width: null,
              height: null,
              bytes: e.metadata?.size || null,
              path,
              filename: filenameFromPath(path),
              created_at: e.created_at || null,
            });
          }
        });
      };

      // Files directly under /turns/<turnId>
      pushFiles(root.data?.filter((x) => x?.metadata && !x.metadata.isDirectory), `turns/${turnId}`);

      // Recurse into any folders (shot_id folders)
      const folders = (root.data || []).filter((x) => x && x.metadata?.isDirectory);
      for (const fold of folders) {
        const sub = await supa.storage.from(bucket).list(`turns/${turnId}/${fold.name}`, {
          limit: 1000,
          sortBy: { column: 'name', order: 'asc' },
        });
        if (!sub.error) {
          pushFiles(sub.data, `turns/${turnId}/${fold.name}`);
        }
      }

      if (items.length) {
        meta.storage_bucket = bucket;
        meta.storage_hits = items.length;
        meta.count = items.length;
        return res.json({ items, meta });
      }
    } else if (debug) {
      meta.error_storage = root.error.message;
    }

    // Nothing found anywhere
    return res.json({ items: [], meta });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'list failed' });
  }
}
