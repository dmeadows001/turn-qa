// pages/api/delete-turn-photo.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { readCleanerSession } from '@/lib/session';

const admin = typeof _admin === 'function' ? _admin() : _admin;
const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || 'photos';
const validUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

async function getCleaner(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return readCleanerSession(req)?.cleaner_id || null;
  const { data, error } = await admin.auth.getUser(match[1].trim());
  if (error || !data?.user?.id) return null;
  const result = await admin.from('cleaners').select('id').eq('id', data.user.id).maybeSingle();
  if (result.error) throw result.error;
  return result.data?.id || null;
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
    const parts = path.split('/');
    if (!validUuid(turnId) || parts.length < 4 || parts[0] !== 'turns' || parts[1] !== turnId ||
        parts.some(p => !p || p === '.' || p === '..') || /[\\?#]/.test(path)) {
      return res.status(400).json({ error: 'Invalid turn ID or photo path' });
    }
    const cleanerId = await getCleaner(req);
    if (!cleanerId) return res.status(401).json({ error: 'Cleaner authentication required' });
    const { data: turn, error: turnError } = await admin.from('turns')
      .select('id, cleaner_id, status').eq('id', turnId).maybeSingle();
    if (turnError) throw turnError;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });
    // Deletion is stricter than registration: only the turn's owning cleaner.
    if (String(turn.cleaner_id) !== String(cleanerId)) {
      return res.status(403).json({ error: 'Not authorized to delete this photo' });
    }
    const { data: photo, error: photoError } = await admin.from('turn_photos')
      .select('id, storage_path, is_fix').eq('turn_id', turnId)
      .eq('storage_path', path).maybeSingle();
    if (photoError) throw photoError;
    if (!photo) return res.status(200).json({ ok: true, alreadyDeleted: true });
    const allowed = (turn.status === 'in_progress' && photo.is_fix !== true) ||
      (turn.status === 'needs_fix' && photo.is_fix === true);
    if (!allowed) return res.status(409).json({
      error: 'Submitted review photos are protected and cannot be deleted',
    });
    // Remove the object before its DB record; preserve record on Storage error.
    const { error: storageError } = await admin.storage.from(BUCKET).remove([path]);
    if (storageError) throw storageError;
    const { data: deleted, error: deleteError } = await admin.from('turn_photos')
      .delete().eq('id', photo.id).eq('turn_id', turnId).select('id');
    if (deleteError) throw deleteError;
    if (!deleted?.length) return res.status(409).json({ error: 'Photo changed; refresh and retry' });
    return res.status(200).json({ ok: true, deleted: true, path });
  } catch (error) {
    console.error('[delete-turn-photo]', error);
    return res.status(500).json({ error: 'Unable to delete photo; please retry' });
  }
}
