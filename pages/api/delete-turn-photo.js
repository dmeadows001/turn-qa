// pages/api/delete-turn-photo.js
// Conservative deletion policy: registered correction photos are immutable.
// This prevents an earlier submitted correction from being deleted during
// a subsequent needs_fix round. Draft tracking requires server-side metadata.
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { readCleanerSession } from '@/lib/session';

const admin = typeof _admin === 'function' ? _admin() : _admin;
const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET || 'photos';

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function getBearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function getCleanerId(req) {
  const token = getBearerToken(req);
  if (!token) {
    const session = readCleanerSession(req);
    return session?.cleaner_id || null;
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  const { data: cleaner, error: cleanerError } = await admin
    .from('cleaners').select('id').eq('id', data.user.id).maybeSingle();
  if (cleanerError) throw cleanerError;
  return cleaner?.id || null;
}

function validPath(path, turnId) {
  const parts = path.split('/');
  return parts.length >= 4 &&
    parts[0] === 'turns' && parts[1] === turnId &&
    parts.every(part => part && part !== '.' && part !== '..') &&
    !/[\\?#]/.test(path);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const turnId = String(body.turnId || body.turn_id || '').trim();
    const path = String(body.path || body.storage_path || '').trim();
    if (!validUuid(turnId) || !validPath(path, turnId)) {
      return res.status(400).json({ error: 'Invalid turn ID or photo path' });
    }

    const cleanerId = await getCleanerId(req);
    if (!cleanerId) return res.status(401).json({ error: 'Cleaner authentication required' });

    const { data: turn, error: turnError } = await admin
      .from('turns').select('id, cleaner_id, status')
      .eq('id', turnId).maybeSingle();
    if (turnError) throw turnError;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });
    if (String(turn.cleaner_id) !== String(cleanerId)) {
      return res.status(403).json({ error: 'Not authorized to delete this turn photo' });
    }

    const { data: photo, error: photoError } = await admin
      .from('turn_photos').select('id, storage_path, is_fix')
      .eq('turn_id', turnId).eq('storage_path', path).maybeSingle();
    if (photoError) throw photoError;
    if (!photo) return res.status(404).json({ error: 'Registered photo not found' });

    // CRITICAL: needs_fix does NOT identify the current correction round.
    // An is_fix photo may have been submitted in a prior round. Never delete it.
    if (turn.status !== 'in_progress' || photo.is_fix === true) {
      return res.status(409).json({
        error: 'Submitted or correction photos are protected. Add another correction photo instead.',
      });
    }

    // Delete the DB record first. If Storage removal fails, the unreferenced
    // object remains, but it cannot reappear in the turn's photo listing.
    const { data: deleted, error: deleteError } = await admin
      .from('turn_photos').delete()
      .eq('id', photo.id).eq('turn_id', turnId)
      .select('id');
    if (deleteError) throw deleteError;
    if (!deleted?.length) return res.status(409).json({ error: 'Photo changed; refresh and retry' });

    const { error: storageError } = await admin.storage.from(BUCKET).remove([path]);
    if (storageError) {
      console.error('[delete-turn-photo] orphaned storage object', { path, storageError });
      return res.status(200).json({
        ok: true, deleted: true, storageCleanupPending: true,
      });
    }
    return res.status(200).json({ ok: true, deleted: true });
  } catch (error) {
    console.error('[delete-turn-photo]', error);
    return res.status(500).json({ error: 'Unable to delete photo; please retry' });
  }
}
