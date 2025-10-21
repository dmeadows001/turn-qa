// pages/api/list-turn-photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

// Pick the bucket; defaults to "photos"
const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

// 6 hours to avoid expiring while users scroll / reopen
const EXPIRES = 60 * 60 * 6;

function firstString(...vals) {
  for (const v of vals) {
    const s = (v ?? '').toString().trim();
    if (s) return s;
  }
  return '';
}
function isHttp(u = '') {
  return /^https?:\/\//i.test(u);
}

/**
 * Create a signed URL for a storage object path.
 * Falls back to publicUrl (in case the bucket/object is public).
 * Returns null if neither works.
 */
async function signPathOrNull(path) {
  try {
    if (!path) return null;

    // Try a signed URL first
    const { data: signed, error: signErr } = await supa
      .storage
      .from(BUCKET)
      .createSignedUrl(path, EXPIRES);

    if (!signErr && signed?.signedUrl) return signed.signedUrl;

    // Fallback to public URL if the object/bucket is public
    const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(path);
    return pub?.publicUrl ?? null;
  } catch (e) {
    // As a last resort, try public url once more
    try {
      const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(path);
      return pub?.publicUrl ?? null;
    } catch {
      return null;
    }
  }
}

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // 1) Pull photos for this turn (no join).
    const { data: tpRows, error: tpErr } = await supa
      .from('turn_photos')
      .select('id, turn_id, shot_id, path, created_at, area_key')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (tpErr) throw tpErr;

    const tp = Array.isArray(tpRows) ? tpRows : [];

    // 2) Build a template_shots map for missing area_key.
    const missingShotIds = Array.from(
      new Set(
        tp
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

    // 3) Fallback: fetch photos table for this turn to recover paths/urls when turn_photos.path is null
    const { data: pRows, error: pErr } = await supa
      .from('photos')
      .select('id, turn_id, shot_id, path, storage_path, photo_path, url, file, created_at')
      .eq('turn_id', turnId);

    if (pErr) {
      console.warn('[list-turn-photos] photos lookup failed', pErr.message || pErr);
    }

    const photos = Array.isArray(pRows) ? pRows : [];

    // Build a lookup by shot_id (most specific)
    const byShot = new Map();
    for (const pr of photos) {
      const key = String(pr.shot_id || '');
      if (!key) continue;
      // Keep first seen; or prefer one that has a path/url
      if (!byShot.has(key)) byShot.set(key, pr);
      else {
        const existing = byShot.get(key);
        const existingHasPath = firstString(existing.path, existing.storage_path, existing.photo_path, existing.file, existing.url);
        const currentHasPath = firstString(pr.path, pr.storage_path, pr.photo_path, pr.file, pr.url);
        if (!existingHasPath && currentHasPath) byShot.set(key, pr);
      }
    }

    // 4) Normalize + sign URLs, with fallbacks to photos table.
    const out = [];
    for (const r of tp) {
      // normalize any path in turn_photos
      let path = firstString(r.path).replace(/^\/+/, '') || '';

      // If empty, try to pull from photos table by shot_id
      if (!path && r.shot_id && byShot.has(String(r.shot_id))) {
        const pr = byShot.get(String(r.shot_id));
        // Pick the best candidate path
        path = firstString(pr.path, pr.storage_path, pr.photo_path, pr.file).replace(/^\/+/, '') || '';
        // If still nothing but `url` is http(s), we'll use that directly as signedUrl
        var directUrl = '';
        const urlCandidate = firstString(pr.url);
        if (!path && isHttp(urlCandidate)) {
          directUrl = urlCandidate;
        }
      }

      const areaKey = r.area_key || tsMap[String(r.shot_id)] || '';

      let signedUrl = '';
      if (path) {
        const s = await signPathOrNull(path);
        signedUrl = s || '';
      } else if (typeof directUrl === 'string' && directUrl) {
        // Use the stored URL (already public/signed)
        signedUrl = directUrl;
      }

      out.push({
        id: r.id,
        turn_id: r.turn_id,
        shot_id: r.shot_id,
        path: path || null,
        created_at: r.created_at,
        area_key: areaKey,
        signedUrl,
      });
    }

    return res.json({ photos: out });
  } catch (e) {
    console.error('[list-turn-photos] error', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
