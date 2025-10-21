// pages/api/list-turn-photos.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

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
      const path = String(r.path || '').replace(/^\/+/, '');
      const areaKey = r.area_key || tsMap[String(r.shot_id)] || '';

      let signedUrl = '';
      if (path) {
        try {
          const { data: s } = await supa.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
          signedUrl = s?.signedUrl || '';
        } catch (e) {
          console.warn('[list-turn-photos] signed url failed for', path, e?.message || e);
        }
      }

      out.push({
        id: r.id,
        turn_id: r.turn_id,
        shot_id: r.shot_id,
        path,
        created_at: r.created_at,
        area_key: areaKey,   // <-- used by the UI to group sections
        signedUrl,
      });
    }

    return res.json({ photos: out });
  } catch (e) {
    console.error('[list-turn-photos] error', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
