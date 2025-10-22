// pages/api/list-turn-photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

// quick helper: does a path look like a real file (has a dot/extension)?
function looksLikeFile(p) {
  return /\.[a-z0-9]+$/i.test(p || '');
}

// normalize strip leading slashes
function cleanPath(p) {
  return String(p || '').replace(/^\/+/, '');
}

// storage.list wrapper to fetch the latest file in a folder
async function findOneFileUnderPrefix(prefix) {
  const folder = cleanPath(prefix).replace(/^\/+/, '');
  // Supabase expects the *folder path relative to the bucket*,
  // without a trailing slash for listing
  const { data, error } = await supa.storage.from(BUCKET).list(folder, {
    limit: 100,
    sortBy: { column: 'name', order: 'desc' }, // pick latest-looking name first
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;

  // Prefer image-like files
  const file = data.find(f => /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name)) || data[0];
  return file ? `${folder}/${file.name}` : null;
}

// Try to select turn_photos including optional columns (e.g., is_fix).
// If a column doesn't exist, we retry without it.
async function selectTurnPhotosFlexible(turnId) {
  // Attempt 1: include optional columns
  const baseCols = 'id, turn_id, shot_id, path, created_at, area_key';
  const optionalCols = ', is_fix'; // add more optional columns here if needed later
  let { data, error } = await supa
    .from('turn_photos')
    .select(baseCols + optionalCols)
    .eq('turn_id', turnId)
    .order('created_at', { ascending: true });

  if (!error) {
    return { rows: Array.isArray(data) ? data : [] };
  }

  // If the error is about a missing column, retry without optional
  if (/column .* does not exist/i.test(error.message || '')) {
    const r2 = await supa
      .from('turn_photos')
      .select(baseCols)
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (r2.error) throw r2.error;
    return { rows: Array.isArray(r2.data) ? r2.data : [] };
  }

  // Other errors: bubble up
  throw error;
}

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // 1) Pull photos for this turn, flexibly (will include is_fix if present)
    const { rows } = await selectTurnPhotosFlexible(turnId);

    // 2) For any rows that are missing area_key, fetch from template_shots by shot_id.
    const missingShotIds = Array.from(
      new Set(
        rows
          .filter(r => !r.area_key && r.shot_id)
          .map(r => String(r.shot_id))
          .filter(Boolean)
      )
    );

    let tsMap = {};
    if (missingShotIds.length) {
      const { data: tsRows, error: tsErr } = await supa
        .from('template_shots')
        .select('id, area_key')
        .in('id', missingShotIds);

      if (!tsErr && Array.isArray(tsRows)) {
        tsMap = Object.fromEntries(tsRows.map(t => [String(t.id), t.area_key || '']));
      } else if (tsErr) {
        console.warn('[list-turn-photos] template_shots lookup failed', tsErr.message || tsErr);
      }
    }

    // 3) Normalize + sign URLs (with folder -> file fallback).
    const out = [];

    // We'll collect any DB updates we want to perform (folder->file backfill)
    const updates = [];

    for (const r of rows) {
      const areaKey = r.area_key || tsMap[String(r.shot_id)] || '';

      // Prefer the DB path; if missing, construct a folder prefix we expect
      // e.g. turns/<turn_id>/<shot_id>
      let objPath = cleanPath(r.path);
      if (!objPath) {
        objPath = `turns/${turnId}/${r.shot_id || ''}`.replace(/\/+$/, '');
      }

      let signedUrl = '';
      let finalPath = objPath;

      try {
        if (!looksLikeFile(finalPath)) {
          // It's a folder prefix — list to find a file under it
          const found = await findOneFileUnderPrefix(finalPath);
          if (found) {
            finalPath = found;
            // Remember to backfill this onto the row so next time is faster
            updates.push({ id: r.id, path: finalPath });
          }
        }

        if (looksLikeFile(finalPath)) {
          const { data: s, error: sErr } = await supa.storage
            .from(BUCKET)
            .createSignedUrl(finalPath, 60 * 60);
          if (!sErr) signedUrl = s?.signedUrl || '';
        }
      } catch (e) {
        console.warn('[list-turn-photos] signing/list error for', objPath, e?.message || e);
      }

      out.push({
        id: r.id,
        turn_id: r.turn_id,
        shot_id: r.shot_id,
        path: finalPath,         // may be folder OR the discovered file key
        created_at: r.created_at,
        area_key: areaKey,
        signedUrl,
        // NEW: include is_fix if the column exists (else false)
        is_fix: Boolean(r.is_fix),
      });
    }

    // 4) Best-effort path backfill (folder -> actual file key), non-blocking
    if (updates.length) {
      try {
        await Promise.all(
          updates.map(u =>
            supa.from('turn_photos').update({ path: u.path }).eq('id', u.id)
          )
        );
      } catch (e) {
        console.warn('[list-turn-photos] backfill update failed', e?.message || e);
      }
    }

    return res.json({ photos: out });
  } catch (e) {
    console.error('[list-turn-photos] error', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
