// pages/api/turns/[id]/notes.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
const supa = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const turnId = (req.query.id || '').toString().trim();
    const debug = req.query.debug === '1';
    if (!turnId) return res.status(400).json({ error: 'missing id' });

    // Overall note — try both columns people commonly use
    let overall_note = '';
    {
      const { data, error } = await supa
        .from('turns')
        .select('manager_note, manager_notes')
        .eq('id', turnId)
        .maybeSingle();
      if (!error && data) {
        overall_note = data.manager_note || data.manager_notes || '';
      }
    }

    const items = [];
    const tried = [];

    // Primary: modern table
    tried.push('turn_photos');
    {
      const { data, error } = await supa
        .from('turn_photos')
        .select('storage_path, path, manager_notes, needs_fix')
        .eq('turn_id', turnId)
        .or('needs_fix.eq.true,manager_notes.not.is.null');

      if (!error && Array.isArray(data)) {
        data.forEach((r) => {
          const path = r.storage_path || r.path || null;
          const note = r.manager_notes || '';
          if (path && note) items.push({ path, note });
        });
      }
    }

    // Legacy: photos table (only if nothing yet)
    if (items.length === 0) {
      tried.push('photos');
      const { data, error } = await supa
        .from('photos')
        .select('storage_path, path, manager_notes, needs_fix')
        .eq('turn_id', turnId)
        .or('needs_fix.eq.true,manager_notes.not.is.null');

      if (!error && Array.isArray(data)) {
        data.forEach((r) => {
          const path = r.storage_path || r.path || null;
          const note = r.manager_notes || '';
          if (path && note) items.push({ path, note });
        });
      }
    }

    const out = { overall_note, items, count: items.length };
    if (debug) out.meta = { tried };
    return res.json(out);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[api notes] error', e);
    return res.status(500).json({ error: e.message || 'notes failed' });
  }
}
