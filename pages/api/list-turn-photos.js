// pages/api/list-turn-photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

function looksLikeFile(p) { return /\.[a-z0-9]+$/i.test(p || ''); }
function cleanPath(p) { return String(p || '').replace(/^\/+/, ''); }

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

    // NOTE: added is_fix, cleaner_note in select
    const { data: tpRows, error: tpErr } = await supa
      .from('turn_photos')
      .select('id, turn_id, shot_id, path, created_at, area_key, is_fix, cleaner_note')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (tpErr) throw tpErr;

    const rows = Array.isArray(tpRows) ? tpRows : [];

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

    const out = [];
    const updates = [];

    for (const r of rows) {
      const areaKey = r.area_key || tsMap[String(r.shot_id)] || '';

      let objPath = cleanPath(r.path);
      if (!objPath) {
        objPath = `turns/${turnId}/${r.shot_id || ''}`.replace(/\/+$/, '');
      }

      let signedUrl = '';
      let finalPath = objPath;

      try {
        if (!looksLikeFile(finalPath)) {
          const found = await findOneFileUnderPrefix(finalPath);
          if (found) {
            finalPath = found;
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
        path: finalPath,
        created_at: r.created_at,
        area_key: areaKey,

        // NEW: surface persistent fix state + note
        is_fix: !!r.is_fix,
        cleaner_note: r.cleaner_note || null,

        signedUrl,
      });
    }

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
