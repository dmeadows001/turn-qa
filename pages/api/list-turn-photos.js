// pages/api/list-turn-photos.js
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const admin = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function looksLikeFile(p) {
  return /\.[a-z0-9]+$/i.test(p || '');
}
function cleanPath(p) {
  return String(p || '').replace(/^\/+/, '');
}

// Create a Supabase client that enforces RLS via the caller's JWT
function createRlsClient(token) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Missing SUPABASE url/anon key');

  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// List a folder to find one file under it (latest-ish by name)
async function findOneFileUnderPrefix(prefix) {
  const folder = cleanPath(prefix).replace(/^\/+/, '');
  const { data, error } = await admin.storage.from(BUCKET).list(folder, {
    limit: 100,
    sortBy: { column: 'name', order: 'desc' },
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const file =
    data.find((f) => /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name)) || data[0];
  return file ? `${folder}/${file.name}` : null;
}

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // Require auth (RLS enforcement depends on this)
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Missing Authorization token' });

    // Validate token
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid/expired token' });

    const rls = createRlsClient(token);

    // 1) Select all photos for this turn (RLS enforced)
    const { data: tpRows, error: tpErr } = await rls
      .from('turn_photos')
      .select(`
        id,
        turn_id,
        shot_id,
        created_at,
        area_key,
        path,
        storage_path,
        is_fix,
        needs_fix,
        cleaner_note,
        manager_notes
      `)
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (tpErr) throw tpErr;

    // 2) Lookup missing area_key via template_shots if needed (RLS enforced)
    const missingShotIds = Array.from(
      new Set(
        (tpRows || [])
          .filter((r) => !r.area_key && r.shot_id)
          .map((r) => String(r.shot_id))
          .filter(Boolean)
      )
    );

    let tsMap = {};
    if (missingShotIds.length) {
      const { data: tsRows, error: tsErr } = await rls
        .from('template_shots')
        .select('id, area_key')
        .in('id', missingShotIds);

      if (!tsErr && Array.isArray(tsRows)) {
        tsMap = Object.fromEntries(tsRows.map((t) => [String(t.id), t.area_key || '']));
      } else if (tsErr) {
        console.warn('[list-turn-photos] template_shots lookup failed', tsErr.message || tsErr);
      }
    }

    // 3) Resolve folder→file, sign, collect updates
    const out = [];
    const updates = [];

    for (const r of tpRows || []) {
      const areaKey = r.area_key || tsMap[String(r.shot_id)] || '';

      const rawPath = r.path || r.storage_path || r.photo_path || r.url || r.file || '';
      let objPath = cleanPath(rawPath);
      if (!objPath) objPath = `turns/${turnId}/${r.shot_id || ''}`.replace(/\/+$/, '');

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
          const { data: s, error: sErr } = await admin.storage
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
        is_fix: r.is_fix ?? undefined,
        needs_fix: r.needs_fix ?? undefined,
        cleaner_note: r.cleaner_note ?? undefined,
        manager_note: (r.manager_note ?? r.manager_notes) ?? undefined,
        orig_path: r.orig_path ?? r.original_path ?? undefined,
        orig_url: r.orig_url ?? r.original_url ?? undefined,
        orig_shotid: r.orig_shotid ?? r.orig_shot_id ?? undefined,
      });
    }

    // 4) Do NOT dedupe — return everything, oldest -> newest
    const finalOut = out.slice().sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return ta - tb;
    });

    // 5) Best-effort backfill (OPTIONAL):
    // Keep behavior, but run updates via admin ONLY for rows user could read (already guaranteed),
    // and only when we have updates.
    if (updates.length) {
      try {
        await Promise.all(
          updates.map((u) => admin.from('turn_photos').update({ path: u.path }).eq('id', u.id))
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
