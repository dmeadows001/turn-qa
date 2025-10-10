// pages/api/turns/[id]/notes.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return undefined;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const turnId = String(req.query.id || '').trim();
  if (!turnId) return res.status(400).json({ error: 'missing id' });

  try {
    // ---- Overall note from the turn (handle a few possible column names) ----
    let overall_note = '';
    try {
      const { data: t } = await supa
        .from('turns')
        .select('manager_note, manager_notes, overall_note')
        .eq('id', turnId)
        .maybeSingle();

      overall_note =
        firstDefined(t?.overall_note, t?.manager_note, t?.manager_notes) || '';
    } catch (_) {}

    // ---- Collect per-photo notes/flags from new and legacy photo tables ----
    const items = [];

    // Helper to push rows using different column spellings
    const pushFromRows = (rows = []) => {
      rows.forEach((r) => {
        const path =
          firstDefined(r.path, r.storage_path, r.photo_path, r.url, r.file) || '';
        const note = firstDefined(r.manager_notes, r.note, r.notes) || '';
        const flagged =
          firstDefined(r.needs_fix, r.flagged, r.is_flagged) || false;

        // Only include items that are either flagged OR have a note
        if (path && (flagged || note)) {
          items.push({ path, note });
        }
      });
    };

    // New table
    try {
      const { data: tp } = await supa
        .from('turn_photos')
        .select('path, storage_path, url, file, photo_path, manager_notes, needs_fix, flagged, is_flagged')
        .eq('turn_id', turnId);
      pushFromRows(tp);
    } catch (_) {}

    // Legacy table
    try {
      const { data: lp } = await supa
        .from('photos')
        .select('path, storage_path, url, file, photo_path, manager_notes, needs_fix, flagged, is_flagged')
        .eq('turn_id', turnId);
      pushFromRows(lp);
    } catch (_) {}

    // De-dup by path (prefer the row that has a note)
    const byPath = new Map();
    for (const it of items) {
      const existing = byPath.get(it.path);
      if (!existing || (!existing.note && it.note)) {
        byPath.set(it.path, it);
      }
    }

    return res.json({
      overall_note,
      items: Array.from(byPath.values()),
      count: byPath.size,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[notes] error', e);
    return res.status(500).json({ error: e.message || 'notes failed' });
  }
}
