// pages/api/turns/[id]/notes.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
const supa = typeof _admin === 'function' ? _admin() : _admin;

function pickPath(row) {
  return (
    row?.storage_path ||
    row?.path ||
    row?.photo_path ||
    row?.url ||
    row?.file ||
    null
  );
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const turnId = (req.query.id || '').toString().trim();
  if (!turnId) return res.status(400).json({ error: 'missing id' });
  const debug = String(req.query.debug || '') === '1';

  const tried = [];
  let overall = '';
  try {
    const { data: t } = await supa
      .from('turns')
      .select('manager_note, manager_notes')
      .eq('id', turnId)
      .maybeSingle();
    overall = t?.manager_note || t?.manager_notes || '';
  } catch {
    // ignore
  }

  const items = [];

  // Preferred table
  tried.push('turn_photos');
  try {
    const { data: tp } = await supa
      .from('turn_photos')
      .select('id, storage_path, path, photo_path, url, file, manager_notes, needs_fix')
      .eq('turn_id', turnId);

    (tp || []).forEach((r) => {
      const p = pickPath(r);
      if (!p) return;
      const note = r?.manager_notes || '';
      const flagged = !!r?.needs_fix || !!note.trim();
      if (flagged) items.push({ path: p, note, needs_fix: !!r?.needs_fix });
    });
  } catch {
    // ignore
  }

  // Legacy fallback
  tried.push('photos');
  try {
    const { data: ph } = await supa
      .from('photos')
      .select('id, storage_path, path, photo_path, url, file, manager_notes, needs_fix')
      .eq('turn_id', turnId);

    (ph || []).forEach((r) => {
      const p = pickPath(r);
      if (!p) return;
      const note = r?.manager_notes || '';
      const flagged = !!r?.needs_fix || !!note.trim();
      if (flagged) items.push({ path: p, note, needs_fix: !!r?.needs_fix });
    });
  } catch {
    // ignore
  }

  // Deduplicate by path
  const seen = new Set();
  const dedup = [];
  for (const it of items) {
    if (seen.has(it.path)) continue;
    seen.add(it.path);
    dedup.push(it);
  }

  const out = {
    overall_note: overall || '',
    items: dedup,
    count: dedup.length,
  };
  if (debug) out.meta = { tried };

  return res.json(out);
}
