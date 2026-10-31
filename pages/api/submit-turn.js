// pages/api/submit-turn.js
// Finalize an initial turn without duplicating photos that were registered
// as soon as their background Storage uploads completed.
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { notifyManagerForTurn } from '@/lib/notify';
import { readCleanerSession } from '@/lib/session';

const supa = typeof _admin === 'function' ? _admin() : _admin;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBody(raw) {
  let body = raw || {};
  if (typeof raw === 'string') {
    try { body = JSON.parse(raw); } catch { body = {}; }
  }
  return {
    turnId: String(body?.turnId || body?.turn_id || '').trim(),
    photos: Array.isArray(body?.photos) ? body.photos : [],
  };
}

function normalizePhotos(turnId, photos) {
  const unique = new Map();
  for (const photo of photos) {
    const path = String(photo?.path || photo?.url || '').trim();
    if (!path || path.startsWith('pending:')) {
      throw new Error('A photo has not finished uploading. Please wait and try again.');
    }
    const parts = path.split('/');
    if (
      parts.length < 4 || parts[0] !== 'turns' || parts[1] !== turnId ||
      parts.some(p => !p || p === '.' || p === '..') ||
      path.includes('\\') || path.includes('?') || path.includes('#')
    ) {
      throw new Error('A photo has an invalid Storage path.');
    }
    const rawShotId = String(photo?.shotId || photo?.shot_id || '').trim();
    // Fallback template identifiers are not UUIDs and cannot be written
    // to the UUID-typed turn_photos.shot_id column.
    const shotId = UUID.test(rawShotId) ? rawShotId : null;
    unique.set(path, {
      turn_id: turnId,
      storage_path: path,
      shot_id: shotId,
      area_key: String(photo?.area_key || ''),
    });
  }
  return [...unique.values()];
}

async function ensurePhotoRows(turnId, rows) {
  if (!rows.length) return;

  // Include both path columns for compatibility with historical photo rows.
  const { data: existing, error: lookupError } = await supa
    .from('turn_photos')
    .select('id, storage_path, path')
    .eq('turn_id', turnId);
  if (lookupError) throw lookupError;

  const knownPaths = new Set();
  for (const row of existing || []) {
    if (row.storage_path) knownPaths.add(row.storage_path);
    if (row.path) knownPaths.add(row.path);
  }

  // Backward compatibility: the old capture page did not register uploads.
  // Insert only missing paths, so a transition to the new capture page does
  // not create duplicate records on normal sequential requests.
  const missing = rows.filter(row => !knownPaths.has(row.storage_path));
  if (!missing.length) return;

  // Verify that every missing file really exists in Storage before inserting.
  const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
    process.env.SUPABASE_STORAGE_BUCKET || 'photos';
  for (const row of missing) {
    const parts = row.storage_path.split('/');
    const filename = parts.pop();
    const folder = parts.join('/');
    const { data: objects, error } = await supa.storage
      .from(bucket).list(folder, { search: filename, limit: 100 });
    if (error) throw error;
    if (!(objects || []).some(object => object.name === filename)) {
      throw new Error(`Uploaded photo not found in Storage: ${filename}`);
    }
  }

  // Insert individually, allowing a concurrent registration request to win.
  for (const row of missing) {
    const { error } = await supa.from('turn_photos').insert(row);
    if (!error) continue;
    if (error.code === '23505') continue; // unique path constraint, if present
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { turnId, photos } = parseBody(req.body);
    if (!UUID.test(turnId)) {
      return res.status(400).json({ error: 'A valid turnId is required' });
    }

    const session = readCleanerSession(req);
    if (!session?.cleaner_id) {
      return res.status(401).json({ error: 'Cleaner authentication required' });
    }

    const { data: turn, error: turnError } = await supa
      .from('turns')
      .select('id, cleaner_id, status, scan_checked_at')
      .eq('id', turnId)
      .maybeSingle();
    if (turnError) throw turnError;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });
    if (String(turn.cleaner_id) !== String(session.cleaner_id)) {
      return res.status(403).json({ error: 'You are not authorized to submit this turnover' });
    }
    if (turn.status !== 'in_progress') {
      return res.status(409).json({ error: `Turn cannot be submitted while status is ${turn.status}` });
    }
    if (!turn.scan_checked_at) {
      return res.status(409).json({
        error: 'AI Scan is required before submitting this turn.',
        code: 'SCAN_REQUIRED',
      });
    }

    let rows;
    try { rows = normalizePhotos(turnId, photos); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    if (!rows.length) {
      return res.status(400).json({ error: 'At least one uploaded photo is required' });
    }

    await ensurePhotoRows(turnId, rows);

    // The status guard also prevents a second successful submission from
    // sending another manager notification.
    const { data: updated, error: updateError } = await supa
      .from('turns')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', turnId)
      .eq('status', 'in_progress')
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return res.status(409).json({ error: 'Turn status changed before submission completed. Please reload.' });
    }

    try {
      await notifyManagerForTurn(turnId, 'initial');
    } catch (notifyError) {
      console.error('[submit-turn] manager notification failed:', notifyError);
      // The turn is already submitted. Do not falsely report submission failure.
    }

    return res.status(200).json({ ok: true, photoCount: rows.length });
  } catch (error) {
    console.error('[submit-turn]', error);
    return res.status(500).json({ error: error?.message || 'submit-turn failed' });
  }
}
