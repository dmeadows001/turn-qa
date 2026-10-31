// pages/api/register-turn-photo.js
// Registers a photo after its Storage upload completes.
// Does NOT submit the turn or notify the manager.

import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { readCleanerSession } from '@/lib/session';

const admin = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

function getBearerToken(req) {
  const match = String(req.headers.authorization || '')
    .match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : null;
}

async function getActor(req) {
  const token = getBearerToken(req);

  // Cleaner authenticated through cookie session
  if (!token) {
    const session = readCleanerSession(req);

    return session?.cleaner_id
      ? { cleanerId: session.cleaner_id, managerId: null }
      : null;
  }

  // Manager or cleaner authenticated through Supabase
  const { data, error } = await admin.auth.getUser(token);

  if (error || !data?.user?.id) return null;

  const userId = data.user.id;

  const [
    { data: manager },
    { data: cleaner }
  ] = await Promise.all([
    admin
      .from('managers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle(),

    admin
      .from('cleaners')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
  ]);

  if (!manager?.id && !cleaner?.id) return null;

  return {
    managerId: manager?.id || null,
    cleanerId: cleaner?.id || null
  };
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const {
      turnId,
      shotId,
      path,
      isFix = false,
      width,
      height,
      bytes
    } = req.body || {};

    const tid = String(turnId || '').trim();
    const sid = String(shotId || '').trim();
    const storagePath = String(path || '').trim();

    // Validate identifiers.
    if (!validUuid(tid) || (sid && !validUuid(sid))) {
      return res.status(400).json({
        error: 'Invalid turnId or shotId'
      });
    }

    // Only accept Storage keys inside this turn's folder.
    // Never accept an external URL or a traversal path.
    const parts = storagePath.split('/');

    if (
      parts.length < 4 ||
      parts[0] !== 'turns' ||
      parts[1] !== tid ||
      parts.some(p => !p || p === '.' || p === '..') ||
      storagePath.includes('\\') ||
      storagePath.includes('?') ||
      storagePath.includes('#')
    ) {
      return res.status(400).json({
        error: 'Invalid storage path'
      });
    }

    // The shot folder must match the supplied shot ID.
    if (sid && parts[2] !== sid) {
      return res.status(400).json({
        error: 'Photo path does not match shotId'
      });
    }

    // Authenticate the request.
    const actor = await getActor(req);

    if (!actor) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    // Load the turn.
    const { data: turn, error: turnError } = await admin
      .from('turns')
      .select('id, manager_id, cleaner_id, status')
      .eq('id', tid)
      .maybeSingle();

    if (turnError) throw turnError;

    if (!turn) {
      return res.status(404).json({
        error: 'Turn not found'
      });
    }

    // Only the assigned cleaner or owning manager can
    // register photos against this turn.
    const authorized =
      (actor.cleanerId &&
        actor.cleanerId === turn.cleaner_id) ||
      (actor.managerId &&
        actor.managerId === turn.manager_id);

    if (!authorized) {
      return res.status(403).json({
        error: 'Not assigned to this turn'
      });
    }

    // Registration must not alter turn status.
    // Initial photos belong to in_progress turns.
    // Fix photos belong to needs_fix turns.
    const status = String(turn.status || '');

    if (
      isFix
        ? status !== 'needs_fix'
        : status !== 'in_progress'
    ) {
      return res.status(409).json({
        error: `Cannot register photo while turn is ${status}`
      });
    }

    // Verify that the uploaded object exists in Storage.
    const filename = parts[parts.length - 1];
    const folder = parts.slice(0, -1).join('/');

    const { data: objects, error: listError } =
      await admin.storage
        .from(BUCKET)
        .list(folder, {
          search: filename,
          limit: 100
        });

    if (listError) throw listError;

    const exists = (objects || []).some(
      object => object.name === filename
    );

    if (!exists) {
      return res.status(409).json({
        error: 'Photo upload not found in Storage'
      });
    }

    // Check whether this photo is already registered.
    // This makes ordinary sequential retries safe.
    const { data: existing, error: lookupError } =
      await admin
        .from('turn_photos')
        .select('id, storage_path, shot_id, is_fix')
        .eq('turn_id', tid)
        .eq('storage_path', storagePath)
        .limit(1)
        .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing) {
      return res.status(200).json({
        ok: true,
        alreadyRegistered: true,
        photo: existing
      });
    }

    // Build the photo record.
    const row = {
      turn_id: tid,
      storage_path: storagePath,
      shot_id: sid || null,
      is_fix: !!isFix
    };

    // Save optional image metadata when supplied.
    for (const [key, value] of Object.entries({
      width,
      height,
      bytes
    })) {
      if (Number.isInteger(value) && value >= 0) {
        row[key] = value;
      }
    }

    // Insert the draft photo record.
    const { data: inserted, error: insertError } =
      await admin
        .from('turn_photos')
        .insert(row)
        .select('id, storage_path, shot_id, is_fix')
        .single();

    if (insertError) {
      // Handle a concurrent duplicate if the database
      // has a unique constraint on the storage path.
      if (insertError.code === '23505') {
        const { data: duplicate } = await admin
          .from('turn_photos')
          .select('id, storage_path, shot_id, is_fix')
          .eq('turn_id', tid)
          .eq('storage_path', storagePath)
          .limit(1)
          .maybeSingle();

        if (duplicate) {
          return res.status(200).json({
            ok: true,
            alreadyRegistered: true,
            photo: duplicate
          });
        }
      }

      throw insertError;
    }

    return res.status(201).json({
      ok: true,
      alreadyRegistered: false,
      photo: inserted
    });

  } catch (error) {
    console.error(
      '[register-turn-photo]',
      error
    );

    return res.status(500).json({
      error: 'Unable to register photo'
    });
  }
}
