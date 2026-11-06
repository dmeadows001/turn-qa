// pages/api/cleaner/discard-turn.js
// Discard only an authenticated cleaner's unsubmitted draft.
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { readCleanerSession } from '@/lib/session';

const admin = typeof _admin === 'function' ? _admin() : _admin;
const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET || 'photos';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safePath(path, turnId) {
  if (typeof path !== 'string') return false;
  const parts = path.split('/');
  return parts.length >= 3 && parts[0] === 'turns' && parts[1] === turnId &&
    parts.every(p => p && p !== '.' && p !== '..') && !/[\\?#]/.test(path);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const sess = readCleanerSession(req);
    const cleanerId = sess?.cleaner_id || sess?.sub;
    if (!cleanerId) return res.status(401).json({ error: 'Cleaner authentication required' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const turnId = String(body.turn_id || '').trim();
    if (!UUID.test(turnId)) return res.status(400).json({ error: 'Invalid turn ID' });

    const { data: turn, error: turnErr } = await admin.from('turns')
      .select('id, cleaner_id, status').eq('id', turnId).maybeSingle();
    if (turnErr) throw turnErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });
    if (String(turn.cleaner_id) !== String(cleanerId)) {
      return res.status(403).json({ error: 'This turn belongs to another cleaner' });
    }
    if (turn.status !== 'in_progress') {
      return res.status(409).json({ error: 'Only unfinished, unsubmitted turns can be discarded' });
    }

    // Fetch every registered photo path. Refuse to discard if an unexpected
    // path is present, to avoid deleting unrelated objects or losing references.
    const paths = new Set();
    let offset = 0;
    while (true) {
      const { data: rows, error: photosErr } = await admin.from('turn_photos')
        .select('storage_path, path').eq('turn_id', turnId)
        .range(offset, offset + 499);
      if (photosErr) throw photosErr;
      for (const row of rows || []) {
        for (const value of [row.storage_path, row.path]) {
          if (!value) continue;
          if (!safePath(value, turnId)) {
            return res.status(409).json({ error: 'Unexpected photo path; manual review required before discarding' });
          }
          paths.add(value);
        }
      }
      if (!rows || rows.length < 500) break;
      offset += rows.length;
    }

    // Storage is deleted first: if it fails, the turn remains visible for retry.
    // Note: Supabase Storage and Postgres do not share a transaction.
    const allPaths = [...paths];
    for (let i = 0; i < allPaths.length; i += 100) {
      const { error: storageErr } = await admin.storage.from(BUCKET).remove(allPaths.slice(i, i + 100));
      if (storageErr) {
        console.error('[discard-turn] storage cleanup failed', { turnId, storageErr });
        return res.status(502).json({ error: 'Photo cleanup failed; turn was not discarded. Please retry.' });
      }
    }

    // Recheck status at deletion time; protects turns already submitted.
    const { data: deleted, error: deleteErr } = await admin.from('turns')
      .delete().eq('id', turnId).eq('cleaner_id', cleanerId)
      .eq('status', 'in_progress').select('id');
    if (deleteErr) throw deleteErr;
    if (!deleted?.length) {
      return res.status(409).json({ error: 'Turn changed during cleanup; refresh and contact support if photos are missing' });
    }
    return res.status(200).json({ ok: true, discarded_turn_id: turnId, removed_photo_paths: allPaths.length });
  } catch (err) {
    console.error('[discard-turn]', err);
    return res.status(500).json({ error: 'Could not discard this turn. Please retry or contact support.' });
  }
}
