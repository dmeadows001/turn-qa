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

    const rows = Array.isArray(tpRows) ? tpRows : [];

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

      if (tsErr) {
        // Not fatal; we can still return photos, just without area_key
        console.warn('[list-turn-photos] template_shots lookup failed', tsErr.message || tsErr);
      } else {
        tsMap = Object.fromEntries((tsRows || []).map(t => [String(t.id), t.area_key || '']));
      }
    }

    // 3) Normalize + sign URLs.
    const out = [];
    for (const r of rows) {
      // normalize path (strip accidental leading slashes)
      const path = String(r.path || '').replace(/^\/+/, '') || null;

      const areaKey = r.area_key || tsMap[String(r.shot_id)] || '';

      let signedUrl = null;
      if (path) {
        signedUrl = await signPathOrNull(path);
        if (!signedUrl) {
          console.warn('[list-turn-photos] could not produce URL for', { bucket: BUCKET, path });
        }
      }

      out.push({
        id: r.id,
        turn_id: r.turn_id,
        shot_id: r.shot_id,
        path,
        created_at: r.created_at,
        area_key: areaKey,  // used by the UI to group sections
        signedUrl: signedUrl || '', // <-- IMPORTANT: camelCase
      });
    }

    return res.json({ photos: out });
  } catch (e) {
    console.error('[list-turn-photos] error', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
