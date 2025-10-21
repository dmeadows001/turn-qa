// pages/api/list-turn-photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

// Try to pull a storage object path out of a URL produced by Supabase Storage.
// Handles both public and signed URLs, e.g.:
//  - /storage/v1/object/public/<bucket>/turns/abc/xyz.jpg
//  - /storage/v1/object/sign/<bucket>/turns/abc/xyz.jpg?token=...
function pathFromSupabaseUrl(url, bucket = BUCKET) {
  if (!url || typeof url !== 'string') return '';
  try {
    // Work with absolute or relative
    const u = url.startsWith('http') ? new URL(url) : new URL(url, 'https://dummy');
    const p = u.pathname || '';
    // Look for “…/object/(public|sign)/<bucket>/<key...>”
    const m = p.match(/\/object\/(?:public|sign)\/([^/]+)\/(.+)/);
    if (m && m[1] && m[2]) {
      const b = decodeURIComponent(m[1]);
      const key = decodeURIComponent(m[2]);
      if (!bucket || b === bucket) return key;
    }

    // Older CDN-style or rewrites (rare) — last-resort guess:
    // If the bucket name appears, take what's after it.
    const idx = p.indexOf(`/${bucket}/`);
    if (idx >= 0) {
      return decodeURIComponent(p.slice(idx + bucket.length + 2));
    }
  } catch {
    // ignore
  }
  return '';
}

// Prefer the first non-empty value
const coalesce = (...vals) => vals.find(v => (typeof v === 'string' && v.trim().length > 0)) || '';

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // --- A) Base rows from turn_photos (source of truth for area_key/shot binding)
    const { data: tpRows, error: tpErr } = await supa
      .from('turn_photos')
      .select('id, turn_id, shot_id, path, created_at, area_key')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (tpErr) throw tpErr;
    const rows = Array.isArray(tpRows) ? tpRows : [];

    // --- B) Optional helper rows from photos (schema varies across installs)
    // Use select('*') so we don't 404 on unknown columns.
    let photosRows = [];
    try {
      const { data: ph, error: phErr } = await supa
        .from('photos')
        .select('*')
        .eq('turn_id', turnId);
      if (!phErr && Array.isArray(ph)) photosRows = ph;
    } catch {
      // photos table might not even exist in some installs — that's fine
      photosRows = [];
    }

    // Build quick lookup maps from photos:
    //  1) by id
    //  2) by shot_id
    const byId = new Map();
    const byShot = new Map();
    for (const r of photosRows) {
      const rid = String(r?.id || '');
      if (rid) byId.set(rid, r);
      const sid = String(r?.shot_id || '');
      if (sid) byShot.set(sid, r);
    }

    const out = [];
    for (const r of rows) {
      const rawPath = String(r.path || '');
      let path = rawPath;

      // Fallback to a photos row for the same id or shot_id
      const ph = byId.get(String(r.id)) || byShot.get(String(r.shot_id)) || null;

      // Try to manufacture a path if missing
      if (!path && ph) {
        // These keys may or may not exist in your schema; we guard via coalesce(*)
        const fromCols = coalesce(
          ph.path,          // some installs
          ph.storage_path,  // others
          ph.photo_path,    // others
        );

        // If columns didn’t help, try extracting the storage key from a URL
        const fromUrl = pathFromSupabaseUrl(ph.url, BUCKET) || pathFromSupabaseUrl(ph.file, BUCKET);

        path = coalesce(fromCols, fromUrl, '');
      }

      // Build a URL to return to the UI
      let signedUrl = '';

      if (path) {
        // We have a storage key — sign it
        try {
          const { data: s } = await supa.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
          signedUrl = s?.signedUrl || '';
        } catch (e) {
          console.warn('[list-turn-photos] signed url create failed', { path, msg: e?.message || e });
        }
      } else if (ph) {
        // No key but we might have a direct http(s) URL saved — use it as-is
        const direct = coalesce(
          (typeof ph.url === 'string' && ph.url.startsWith('http')) ? ph.url : '',
          (typeof ph.file === 'string' && ph.file.startsWith('http')) ? ph.file : '',
        );
        if (direct) signedUrl = direct;
      }

      // Area grouping (either already on turn_photos, or fallback from template_shots via your other API)
      const areaKey = r.area_key || '';

      out.push({
        id: r.id,
        turn_id: r.turn_id,
        shot_id: r.shot_id,
        path: path || '',        // normalized storage key if we found one
        created_at: r.created_at,
        area_key: areaKey,
        signedUrl,               // either signed storage URL or a direct saved URL
      });
    }

    return res.json({ photos: out });
  } catch (e) {
    console.error('[list-turn-photos] error', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
