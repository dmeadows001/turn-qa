// pages/api/list-turn-photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

function looksLikeFile(p) {
  return /\.[a-z0-9]+$/i.test(p || '');
}
function cleanPath(p) {
  return String(p || '').replace(/^\/+/, '');
}

// List a folder to find one file under it (latest-ish by name)
async function findOneFileUnderPrefix(prefix) {
  const folder = cleanPath(prefix).replace(/^\/+/, '');
  const { data, error } = await supa.storage.from(BUCKET).list(folder, {
    limit: 100,
    sortBy: { column: 'name', order: 'desc' },
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const file = data.find(f => /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name)) || data[0];
  return file ? `${folder}/${file.name}` : null;
}

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // 1) Try to select with optional columns; if that fails because the columns
    // don't exist in this env, retry with the minimal select.
    let tpRows = [];
    let tpErr = null;

    const trySelect = async (withOptional, baseCols) => {
      const opt = withOptional ? ', is_fix, cleaner_note' : '';
      return await supa
        .from('turn_photos')
        .select(baseCols + opt)
        .eq('turn_id', turnId)
        .order('created_at', { ascending: true });
    };

    // Try widest set of path columns; on “column does not exist” retry with smaller sets
    const bases = [
      // widest
      'id, turn_id, shot_id, created_at, area_key, path, storage_path, photo_path, url, file',
      // medium
      'id, turn_id, shot_id, created_at, area_key, path, storage_path, url, file',
      // minimal (most common)
      'id, turn_id, shot_id, created_at, area_key, path'
    ];

    for (const baseCols of bases) {
      const resp = await trySelect(true, baseCols);
      if (!resp.error) { tpRows = resp.data || []; break; }
      const msg = String(resp.error.message || '').toLowerCase();
      if (!/column .* does not exist/.test(msg)) { tpErr = resp.error; break; }
      // else: loop and try a smaller base
    }
    if (!tpRows.length && !tpErr) {
      // last-ditch attempt with the minimal base and no optional columns
      const last = await trySelect(false, 'id, turn_id, shot_id, created_at, area_key, path');
      tpErr = last.error || null;
      tpRows = Array.isArray(last.data) ? last.data : [];
    }
    if (tpErr) throw tpErr;

    // 2) Lookup missing area_key via template_shots if needed
    const missingShotIds = Array.from(
      new Set(
        tpRows
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

    // 3) Resolve folder→file, sign, collect updates
    const out = [];
    const updates = [];

    for (const r of tpRows) {
      const areaKey = r.area_key || tsMap[String(r.shot_id)] || '';

      // Normalize across multiple possible column names
      const rawPath =
        r.path ||
        r.storage_path ||
        r.photo_path ||
        r.url ||
        r.file ||
        '';
      let objPath = cleanPath(rawPath);
      if (!objPath) {
        objPath = `turns/${turnId}/${r.shot_id || ''}`.replace(/\/+$/, '');
      }

      let finalPath = objPath;
      let signedUrl = '';

      try {
        if (!looksLikeFile(finalPath)) {
          const found = await findOneFileUnderPrefix(finalPath);
          if (found) {
            finalPath = found;
            if (r.id) updates.push({ id: r.id, path: finalPath });
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
        path: finalPath,
        created_at: r.created_at,
        area_key: areaKey,
        signedUrl,
        // carry-through if present (undefined if not selected)
        is_fix: r.is_fix ?? undefined,
        cleaner_note: r.cleaner_note ?? undefined,
      });
    }

    // 4) **Dedupe by final path** (this collapses multiple rows that resolved to same file)
    const seenByPath = new Set();
    const finalOut = [];
    for (const row of out) {
      const key = row.path || ''; // final resolved key
      if (!key) continue;
      if (seenByPath.has(key)) continue;
      seenByPath.add(key);
      finalOut.push(row);
    }

    // 5) Best-effort backfill
    if (updates.length) {
      try {
        await Promise.all(
          updates.map(u => supa.from('turn_photos').update({ path: u.path }).eq('id', u.id))
        );
      } catch (e) {
        console.warn('[list-turn-photos] backfill update failed', e?.message || e);
      }
    }

    return res.json({ photos: finalOut });
  } catch (e) {
    console.error('[list-turn-photos] error', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
