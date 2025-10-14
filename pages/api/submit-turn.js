// pages/api/submit-turn.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { notifyManagerForTurn } from '@/lib/notify';

// Support both export styles (function returning client vs direct client)
const supa = typeof _admin === 'function' ? _admin() : _admin;

function nowIso() { return new Date().toISOString(); }

// ----------------- body parsing -----------------
function parseBody(raw) {
  let body = raw;
  if (typeof raw === 'string') {
    try { body = JSON.parse(raw); } catch { body = {}; }
  }
  const turnId = (body.turnId || body.turn_id || '').trim();
  const photos = Array.isArray(body.photos) ? body.photos : [];
  return { turnId, photos };
}

// ----------------- build rows -----------------
function buildRows(turnId, photos) {
  // capture.js sends: { name, shotId, url: up.path, width, height, preview }
  const rows = (photos || [])
    .map(p => {
      const storagePath = (p.path || p.url || '').toString().trim();
      if (!storagePath) return null;
      return {
        turn_id: turnId,
        _path_value: storagePath,
        shot_id: p.shotId || p.shot_id || null,
        area_key: p.area_key || '',
        created_at: nowIso(),
      };
    })
    .filter(Boolean);
  return rows;
}

// ----------------- tolerant inserts -----------------
async function tolerantInsertTurnPhotos(rows) {
  if (!rows.length) return { ok: true, tried: 0 };

  const shapes = [
    r => ({ turn_id: r.turn_id, storage_path: r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, path:          r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, photo_path:    r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, url:           r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, file:          r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, storage_path:  r._path_value }),
    r => ({ turn_id: r.turn_id, path:          r._path_value }),
  ];

  let lastErr = null;
  let tried = 0;

  for (const make of shapes) {
    tried++;
    const payload = rows.map(make);
    const { error } = await supa.from('turn_photos').insert(payload, { returning: 'minimal' });
    if (!error) return { ok: true, tried };
    const msg = (error.message || '').toLowerCase();
    if (!/column|does not exist|null value|constraint|invalid input|duplicate/i.test(msg)) {
      lastErr = error; break;
    }
    lastErr = error;
  }

  return { ok: false, tried, error: lastErr };
}

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

// ----------------- handler -----------------
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { turnId, photos } = parseBody(req.body);
    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    // 1) Insert photos (tolerant)
    const rows = buildRows(turnId, photos);
    if (rows.length) {
      const ins = await tolerantInsertTurnPhotos(rows);
      if (!ins.ok) {
        const fb = await fallbackInsertLegacyPhotos(rows);
        if (!fb.ok) {
