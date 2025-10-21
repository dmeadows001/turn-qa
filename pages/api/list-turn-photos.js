// pages/api/list-turn-photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

// Extract a storage key from a Supabase Storage URL (public or signed)
function pathFromSupabaseUrl(url, bucket = BUCKET) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = url.startsWith('http') ? new URL(url) : new URL(url, 'https://x');
    const p = u.pathname || '';

    // /object/(public|sign)/<bucket>/<key...>
    const m = p.match(/\/object\/(?:public|sign)\/([^/]+)\/(.+)/);
    if (m && decodeURIComponent(m[1]) === bucket) {
      return decodeURIComponent(m[2]);
    }

    // Fallback: /<bucket>/...
    const idx = p.indexOf(`/${bucket}/`);
    if (idx >= 0) return decodeURIComponent(p.slice(idx + bucket.length + 2));
  } catch {}
  return '';
}

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // 1) Base rows (order & section source)
    const { data: tpRows, error: tpErr } = await supa
      .from('turn_photos')
      .select('id, turn_id, shot_id, path, created_at, area_key')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });
    if (tpErr) throw tpErr;
    const rows = Array.isArray(tpRows) ? tpRows : [];

    // 2) If any rows are missing area_key, fetch from template_shots (by shot_id)
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
      try {
        const { data: tsRows, error: tsErr } = await supa
          .from('template_shots')
          .select('id, area_key')
          .in('id', missingShotIds);
        if (!tsErr && Array.isArray(tsRows)) {
          tsMap = Object.fromEntries(tsRows.map(t => [String(t.id), t.area_key || '']));
        }
      } catch {}
    }

    // 3) Optionally read photos rows (schema-agnostic: select '*')
    let photosRows = [];
    try {
      const { data: ph, error: phErr } = await supa.from('photos').select('*').eq('turn_id', turnId);
      if (!phErr && Array.isArray(ph)) photosRows = ph;
    } catch {}
    const photosById = new Map();
    for (const ph of photosRows) {
      const pid = String(ph?.id || '');
      if (pid) photosById.set(pid, ph);
    }

    // 4) List storage for the turn; used to match by filename if needed
    let storageIndex = [];
    try {
      const { data: files, error: listErr } = await supa.storage
        .from(BUCKET)
        .list(`turns/${turnId}`, { limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } });
      if (!listErr && Array.isArray(files)) {
        storageIndex = files
          .filter(f => f && typeof f.name === 'string')
          .map(f => ({ name: f.name, key: `turns/${turnId}/${f.name}` }));
      }
    } catch (e) {
      console.warn('[list-turn-photos] storage list failed', e?.message || e);
    }

    // Helpers to recover a storage key/URL
    function keyFromPhotosRow(ph) {
      if (!ph || typeof ph !== 'object') return { key: '', directUrl: '' };

      // 1) any http(s) field -> try parse as Storage URL
      for (const v of Object.values(ph)) {
        if (typeof v === 'string' && v.startsWith('http')) {
          const maybe = pathFromSupabaseUrl(v, BUCKET);
          if (maybe) return { key: maybe, directUrl: '' };
        }
      }

      // 2) any string that already looks like a storage key/path
      for (const v of Object.values(ph)) {
        if (typeof v === 'string' && v.includes(`turns/${turnId}/`)) {
          return { key: v.replace(/^\/+/, ''), directUrl: '' };
        }
      }

      // 3) last resort: pass through a direct URL so the <img> still renders
      for (const v of Object.values(ph)) {
        if (typeof v === 'string' && v.startsWith('http')) {
          return { key: '', directUrl: v };
        }
      }
      return { key: '', directUrl: '' };
    }

    function keyFromStorageByShot(shotId) {
      const sid = String(shotId || '');
      if (!sid) return '';
      const hit = storageIndex.find(f => f.name.includes(sid));
      return hit ? hit.key : '';
    }

    // 5) Build response
    const out = [];
    for (const r of rows) {
      let areaKey = r.area_key || tsMap[String(r.shot_id)] || '';

      // Find a usable path/URL
      let key = String(r.path || '');
      let directUrl = '';

      if (!key) {
        const ph = photosById.get(String(r.id));
        if (ph) {
          const got = keyFromPhotosRow(ph);
          key = got.key || '';
          directUrl = got.directUrl || '';
        }
      }
      if (!key && !directUrl) {
        key = keyFromStorageByShot(r.shot_id);
      }

      // Get a URL for the <img>
      let signedUrl = '';
      if (key) {
        try {
          // try 1: signed (works with private buckets)
          const s = await supa.storage.from(BUCKET).createSignedUrl(key, 3600);
          signedUrl = s?.data?.signedUrl || s?.signedUrl || '';
          if (!signedUrl) {
            // try 2: public URL (works if bucket is public or has public file)
            const pub = supa.storage.from(BUCKET).getPublicUrl(key);
            signedUrl = pub?.data?.publicUrl || pub?.publicUrl || '';
          }
        } catch (e) {
          console.warn('[list-turn-photos] sign/public url failed', { key, msg: e?.message || e });
        }
      } else if (directUrl) {
        signedUrl = directUrl;
      }

      out.push({
        id: r.id,
        turn_id: r.turn_id,
        shot_id: r.shot_id,
        path: key || '',
        created_at: r.created_at,
        area_key: areaKey,       // <- grouping key for the UI
        signedUrl,
      });
    }

    return res.json({ photos: out });
  } catch (e) {
    console.error('[list-turn-photos] error', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
