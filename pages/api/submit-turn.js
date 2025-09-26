// pages/api/submit-turn.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  // server-side key so RLS won't block writes
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function nowIso() { return new Date().toISOString(); }

// Parse POST body into { turnId, photos[] }
function parseBody(raw) {
  let body = raw;
  if (typeof raw === 'string') {
    try { body = JSON.parse(raw); } catch { body = {}; }
  }
  const turnId = (body.turnId || body.turn_id || '').trim();
  const photos = Array.isArray(body.photos) ? body.photos : [];
  return { turnId, photos };
}

// Build normalized rows from capture payload
function buildRows(turnId, photos) {
  // capture.js sends: { name, shotId, url: up.path, width, height, preview }
  const rows = (photos || [])
    .map(p => {
      const storagePath = (p.path || p.url || '').toString().trim();
      if (!storagePath) return null;
      return {
        turn_id: turnId,
        // We'll map this to whichever column your table actually has
        _path_value: storagePath,
        shot_id: p.shotId || p.shot_id || null,
        area_key: p.area_key || '',  // optional
        created_at: nowIso(),
      };
    })
    .filter(Boolean);
  return rows;
}

// Try inserting into turn_photos with multiple column shapes
async function tolerantInsertTurnPhotos(rows) {
  if (!rows.length) return { ok: true, tried: 0 };

  const shapes = [
    // Most common in your schema (NOT NULL storage_path)
    r => ({ turn_id: r.turn_id, storage_path: r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    // Our newer code path
    r => ({ turn_id: r.turn_id, path:          r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    // Other common variations
    r => ({ turn_id: r.turn_id, photo_path:    r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, url:           r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, file:          r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    // Minimal shape (if area/shot cols don't exist yet)
    r => ({ turn_id: r.turn_id, storage_path: r._path_value }),
    r => ({ turn_id: r.turn_id, path:         r._path_value }),
  ];

  let lastErr = null;
  let tried = 0;

  for (const make of shapes) {
    tried++;
    const payload = rows.map(make);
    const { error } = await supa.from('turn_photos').insert(payload, { returning: 'minimal' });
    if (!error) return { ok: true, tried };
    // Only keep looping on column/constraint issues; otherwise bubble up
    const msg = (error.message || '').toLowerCase();
    if (!/column|does not exist|null value|constraint|invalid input|duplicate/i.test(msg)) {
      lastErr = error; break;
    }
    lastErr = error;
  }

  return { ok: false, tried, error: lastErr };
}

// Fallback to legacy table if turn_photos fails
async function fallbackInsertLegacyPhotos(rows) {
  if (!rows.length) return { ok: true };
  const shapes = [
    r => ({ turn_id: r.turn_id, path:          r._path_value, area_key: r.area_key || '', created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, storage_path:  r._path_value, area_key: r.area_key || '', created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, photo_path:    r._path_value, area_key: r.area_key || '', created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, url:           r._path_value, area_key: r.area_key || '', created_at: r.created_at }),
  ];
  let lastErr = null;
  for (const make of shapes) {
    const payload = rows.map(make);
    const { error } = await supa.from('photos').insert(payload, { returning: 'minimal' });
    if (!error) return { ok: true };
    const msg = (error.message || '').toLowerCase();
    if (!/column|does not exist|null value|constraint|invalid input|duplicate/i.test(msg)) {
      lastErr = error; break;
    }
    lastErr = error;
  }
  return { ok: false, error: lastErr };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { turnId, photos } = parseBody(req.body);
    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    const rows = buildRows(turnId, photos);

    // Insert photos with tolerant shapes
    if (rows.length) {
      const ins = await tolerantInsertTurnPhotos(rows);
      if (!ins.ok) {
        const fb = await fallbackInsertLegacyPhotos(rows);
        if (!fb.ok) {
          throw new Error((ins.error?.message || fb.error?.message) || 'could not insert photos');
        }
      }
    }

    // Mark the turn as submitted
    {
      const { error } = await supa
        .from('turns')
        .update({ status: 'submitted', submitted_at: nowIso() })
        .eq('id', turnId);
      if (error) throw error;
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('submit-turn error', e);
    return res.status(500).json({ error: e.message || 'submit-turn failed' });
  }
}
