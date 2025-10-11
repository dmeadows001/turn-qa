// pages/api/turns/[id]/notes.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const turnId = String(req.query.id || '').trim();
  const debug = String(req.query.debug || '') === '1';
  if (!turnId) return res.status(400).json({ error: 'missing id' });

  try {
    // Overall note on the turn (we’ve used both manager_note and manager_notes historically)
    let overall_note = '';
    {
      const { data: t, error } = await supa
        .from('turns')
        .select('manager_note, manager_notes')
        .eq('id', turnId)
        .maybeSingle();
      if (error) throw error;
      overall_note = (t?.manager_note || t?.manager_notes || '') ?? '';
    }

    // Helper: normalize a result row to { path, note }
    const normRow = (r) => {
      const path = r?.path || r?.storage_path || r?.photo_path || r?.url || null;
      const note = r?.manager_notes || r?.manager_note || r?.note || null;
      return path && (note || r?.needs_fix) ? { path, note: String(note || '') } : null;
    };

    // Try new table first: turn_photos
    let items = [];
    let tried = [];

    tried.push('turn_photos');
    {
      const { data, error } = await supa
        .from('turn_photos')
        .select('id, turn_id, path, storage_path, manager_notes, needs_fix')
        .eq('turn_id', turnId)
        .or('needs_fix.eq.true,manager_notes.not.is.null'); // either flagged or has a note
      if (error && !/relation .* does not exist/i.test(error.message)) throw error;

      if (Array.isArray(data) && data.length) {
        items = data.map(normRow).filter(Boolean);
      }
    }

    // Legacy table fallback: photos
    if (items.length === 0) {
      tried.push('photos');
      const { data, error } = await supa
        .from('photos')
        .select('id, turn_id, path, storage_path, manager_notes, needs_fix')
        .eq('turn_id', turnId)
        .or('needs_fix.eq.true,manager_notes.not.is.null');
      if (error && !/relation .* does not exist/i.test(error.message)) throw error;

      if (Array.isArray(data) && data.length) {
        items = data.map(normRow).filter(Boolean);
      }
    }

    const payload = {
      overall_note,
      items,
      count: items.length,
    };

    if (debug) {
      return res.json({ ...payload, meta: { tried } });
    }
    return res.json(payload);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[notes] error', e);
    return res.status(500).json({ error: e.message || 'notes failed' });
  }
}
