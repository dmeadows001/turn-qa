// pages/api/list-turn-photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

// choose the first non-empty field as the path, or return an absolute url if that's what we have
function pickBestPathFromPhotosRow(p) {
  const candidates = [
    p?.path,
    p?.storage_path,
    p?.photo_path,
    p?.file,
  ].map(x => (x || '').trim()).filter(Boolean);

  // If `url` is already an absolute URL, we can return it as-is (no signing needed).
  const absoluteUrl = (p?.url || '').trim();
  if (absoluteUrl && /^https?:\/\//i.test(absoluteUrl)) {
    return { storagePath: '', absoluteUrl };
  }

  const storagePath = (candidates[0] || '').replace(/^\/+/, '');
  return { storagePath, absoluteUrl: '' };
}

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // 1) turn_photos for this turn (path may be null)
    const { data: tpRows, error: tpErr } = await supa
      .from('turn_photos')
      .select('id, turn_id, shot_id, path, created_at, area_key')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (tpErr) throw tpErr;
    const rows = Array.isArray(tpRows) ? tpRows : [];

    // 2) For rows missing area_key, look it up from template_shots via shot_id
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

      if (tsErr) {
        console.warn('[list-turn-photos] template_shots lookup failed', tsErr.message || tsErr);
      } else {
        tsMap = Object.fromEntries((tsRows || []).map(t => [String(t.id), t.area_key || '']));
      }
    }

    // 3) For rows missing path, try to source it from the photos table by matching IDs.
    const idsNeedingPath = rows.filter(r => !r.path).map(r => String(r.id));
    let photosMap = {};
    if (idsNeedingPath.length) {
      const { data: pRows, error: pErr } = await supa
        .from('photos')
        .select('id, path, storage_path, photo_path, file, url')
        .in('id', idsNeedingPath);

      if (pErr) {
        console.warn('[list-turn-photos] photos lookup failed', pErr.message || pErr);
      } else {
        photosMap = Object.fromEntries((pRows || []).map(p => [String(p.id), p]));
      }
    }

    // 4) Build output + sign storage paths
    const out = [];
    for (const r of rows) {
      const areaKey = r.area_key || tsMap[String(r.shot_id)] || '';

      // prefer turn_photos.path; if missing, fall back to a photos row
      let storagePath = String(r.path || '').replace(/^\/+/, '');
      let absoluteUrl = '';

      if (!storagePath) {
        const pRow = photosMap[String(r.id)];
        if (pRow) {
          const best = pickBestPathFromPhotosRow(pRow);
          storagePath = best.storagePath;
          absoluteUrl  = best.absoluteUrl;
        }
      }

      let signedUrl = '';
      if (absoluteUrl) {
        // Already a full URL (likely public or pre-signed) — use it directly.
        signedUrl = absoluteUrl;
      } else if (storagePath) {
        try {
          const { data: s } = await supa.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60);
          signedUrl = s?.signedUrl || '';
        } catch (e) {
          console.warn('[list-turn-photos] signed url failed for', storagePath, e?.message || e);
        }
      }

      out.push({
        id: r.id,
        turn_id: r.turn_id,
        shot_id: r.shot_id,
        path: storagePath || null,   // normalized storage path if we have one
        created_at: r.created_at,
        area_key: areaKey,           // used by UI to group sections
        signedUrl,                   // UI <img src={signedUrl}>
      });
    }

    return res.json({ photos: out });
  } catch (e) {
    console.error('[list-turn-photos] error', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
