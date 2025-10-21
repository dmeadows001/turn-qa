// pages/api/list-turn-photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

// Pull a storage object key out of a Supabase Storage URL (public or signed)
function pathFromSupabaseUrl(url, bucket = BUCKET) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = url.startsWith('http') ? new URL(url) : new URL(url, 'https://dummy');
    const p = u.pathname || '';
    const m = p.match(/\/object\/(?:public|sign)\/([^/]+)\/(.+)/);
    if (m && m[1] && m[2] && decodeURIComponent(m[1]) === bucket) {
      return decodeURIComponent(m[2]);
    }
    const idx = p.indexOf(`/${bucket}/`);
    if (idx >= 0) return decodeURIComponent(p.slice(idx + bucket.length + 2));
  } catch {}
  return '';
}

const coalesce = (...vals) =>
  vals.find(v => typeof v === 'string' && v.trim().length > 0) || '';

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // A) Source of truth for sections & order
    const { data: tpRows, error: tpErr } = await supa
      .from('turn_photos')
      .select('id, turn_id, shot_id, path, created_at, area_key')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (tpErr) throw tpErr;
    const rows = Array.isArray(tpRows) ? tpRows : [];

    // B) Optional: inspect photos with * to avoid schema assumptions
    let photosRows = [];
    try {
      const { data: ph, error: phErr } = await supa
        .from('photos')
        .select('*')
        .eq('turn_id', turnId);
      if (!phErr && Array.isArray(ph)) photosRows = ph;
    } catch {
      photosRows = [];
    }

    // Build quick lookups from photos (best-effort)
    const byId = new Map();
    const allPhotos = [];
    for (const r of photosRows) {
      if (r && typeof r === 'object') {
        const rid = String(r.id || '');
        if (rid) byId.set(rid, r);
        allPhotos.push(r);
      }
    }

    // C) New: list objects in storage under turns/<turnId>
    //    (non-recursive; your earlier paths showed files directly there)
    let storageIndex = [];
    try {
      const { data: files, error: listErr } = await supa.storage
        .from(BUCKET)
        .list(`turns/${turnId}`, { limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } });

      if (!listErr && Array.isArray(files)) {
        storageIndex = files
          .filter(f => f && typeof f.name === 'string')
          .map(f => ({
            name: f.name,                     // filename.ext
            key: `turns/${turnId}/${f.name}`, // storage object key
          }));
      }
    } catch (e) {
      console.warn('[list-turn-photos] storage list failed', e?.message || e);
    }

    // Helper: try to recover a storage key from a photos row (scan all string fields)
    function keyFromPhotosRow(ph) {
      if (!ph || typeof ph !== 'object') return { key: '', directUrl: '' };

      // 1) any http(s) field -> see if it's a storage URL
      for (const [k, v] of Object.entries(ph)) {
        if (typeof v === 'string' && v.startsWith('http')) {
          const maybeKey = pathFromSupabaseUrl(v, BUCKET);
          if (maybeKey) return { key: maybeKey, directUrl: '' };
        }
      }

      // 2) any string that looks like a path-ish thing
      for (const [k, v] of Object.entries(ph)) {
        if (typeof v === 'string' && v.includes('/')) {
          // If it already looks like "turns/<turnId>/..."
          if (v.includes(`turns/${turnId}/`)) return { key: v.replace(/^\/+/, ''), directUrl: '' };
        }
      }

      // 3) last resort: if we have a direct http URL and not a storage key, return direct URL
      for (const [k, v] of Object.entries(ph)) {
        if (typeof v === 'string' && v.startsWith('http')) {
          return { key: '', directUrl: v };
        }
      }

      return { key: '', directUrl: '' };
    }

    // Helper: match a storage file by containing the shot_id in its filename
    function keyFromStorageByShot(shotId) {
      const sid = String(shotId || '');
      if (!sid) return '';
      const hit = storageIndex.find(f => f.name.includes(sid));
      return hit ? hit.key : '';
    }

    const out = [];

    for (const r of rows) {
      const areaKey = r.area_key || '';
      let key = String(r.path || '');
      let directUrl = '';

      // If turn_photos.path missing, try photos row by same id
      if (!key) {
        const ph = byId.get(String(r.id));
        if (ph) {
          const got = keyFromPhotosRow(ph);
          key = got.key || '';
          directUrl = got.directUrl || '';
        }
      }

      // If still no key/direct URL, try to find in storage by shot_id pattern
      if (!key && !directUrl) {
        key = keyFromStorageByShot(r.shot_id);
      }

      let signedUrl = '';

      if (key) {
        try {
          const { data: s, error: signErr } = await supa.storage.from(BUCKET).createSignedUrl(key, 60 * 60);
          if (!signErr) signedUrl = s?.signedUrl || '';
        } catch (e) {
          console.warn('[list-turn-photos] sign failed', { key, msg: e?.message || e });
        }
      } else if (directUrl) {
        signedUrl = directUrl; // fine to pass through a real URL
      }

      out.push({
        id: r.id,
        turn_id: r.turn_id,
        shot_id: r.shot_id,
        path: key || '',
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
