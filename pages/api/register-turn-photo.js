
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

  if (!token) {
    const session = readCleanerSession(req);

    return session?.cleaner_id
      ? {
          cleanerId: session.cleaner_id,
          managerId: null,
        }
      : null;
  }

  const { data, error } = await admin.auth.getUser(token);

  if (error || !data?.user?.id) return null;

  const userId = data.user.id;

  const [{ data: manager }, { data: cleaner }] =
    await Promise.all([
      admin
        .from('managers')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle(),

      admin
        .from('cleaners')
        .select('id')
        .eq('id', userId)
        .maybeSingle(),
    ]);

  if (!manager?.id && !cleaner?.id) return null;

  return {
    managerId: manager?.id || null,
    cleanerId: cleaner?.id || null,
  };
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

async function authorizeTurn(actor, turn) {
  if (
    actor.managerId &&
    String(actor.managerId) === String(turn.manager_id)
  ) {
    return true;
  }

  if (
    actor.cleanerId &&
    String(actor.cleanerId) === String(turn.cleaner_id)
  ) {
    return true;
  }

  if (!actor.cleanerId || !turn.property_id) {
    return false;
  }

  const [cpRes, pcRes] = await Promise.all([
    admin
      .from('cleaner_properties')
      .select('id')
      .eq('cleaner_id', actor.cleanerId)
      .eq('property_id', turn.property_id)
      .maybeSingle(),

    admin
      .from('property_cleaners')
      .select('id')
      .eq('cleaner_id', actor.cleanerId)
      .eq('property_id', turn.property_id)
      .maybeSingle(),
  ]);

  return !!cpRes?.data?.id || !!pcRes?.data?.id;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);

    return res.status(405).json({
      error: 'Method not allowed',
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
      bytes,
    } = req.body || {};

    const tid = String(turnId || '').trim();
    const sid = String(shotId || '').trim();
    const storagePath = String(path || '').trim();

    if (!validUuid(tid) || (sid && !validUuid(sid))) {
      return res.status(400).json({
        error: 'Invalid turnId or shotId',
      });
    }

    const parts = storagePath.split('/');

    if (
      parts.length < 4 ||
      parts[0] !== 'turns' ||
      parts[1] !== tid ||
      parts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..'
      ) ||
      storagePath.includes('\\') ||
      storagePath.includes('?') ||
      storagePath.includes('#')
    ) {
      return res.status(400).json({
        error: 'Invalid storage path',
      });
    }

    // upload-url.js uses "misc" when no shot ID exists.
    if (sid && parts[2] !== sid) {
      return res.status(400).json({
        error: 'Photo path does not match shotId',
      });
    }

    const actor = await getActor(req);

    if (!actor) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    const { data: turn, error: turnError } = await admin
      .from('turns')
      .select(
        'id, property_id, manager_id, cleaner_id, status'
      )
      .eq('id', tid)
      .maybeSingle();

    if (turnError) throw turnError;

    if (!turn) {
      return res.status(404).json({
        error: 'Turn not found',
      });
    }

    const authorized = await authorizeTurn(actor, turn);

    if (!authorized) {
      return res.status(403).json({
        error: 'Not authorized for this turn',
      });
    }

    const status = String(turn.status || '');

    if (
      (isFix && status !== 'needs_fix') ||
      (!isFix && status !== 'in_progress')
    ) {
      return res.status(409).json({
        error:
          `Cannot register photo while turn is ${status}`,
      });
    }

    // Verify that the object exists in Supabase Storage.
    const filename = parts[parts.length - 1];
    const folder = parts.slice(0, -1).join('/');

    const { data: objects, error: listError } =
      await admin.storage
        .from(BUCKET)
        .list(folder, {
          search: filename,
          limit: 100,
        });

    if (listError) throw listError;

    const exists = (objects || []).some(
      (object) => object.name === filename
    );

    if (!exists) {
      return res.status(409).json({
        error: 'Photo upload not found in Storage',
      });
    }

    // Check for a previously registered photo.
    const { data: existing, error: lookupError } =
      await admin
        .from('turn_photos')
        .select(
          'id, storage_path, shot_id, is_fix'
        )
        .eq('turn_id', tid)
        .eq('storage_path', storagePath)
        .limit(1)
        .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing) {
      return res.status(200).json({
        ok: true,
        alreadyRegistered: true,
        photo: existing,
      });
    }

    const row = {
      turn_id: tid,
      storage_path: storagePath,
      shot_id: sid || null,
      is_fix: !!isFix,
    };

    for (const [key, value] of Object.entries({
      width,
      height,
      bytes,
    })) {
      if (
        Number.isInteger(value) &&
        value >= 0
      ) {
        row[key] = value;
      }
    }

    const { data: inserted, error: insertError } =
      await admin
        .from('turn_photos')
        .insert(row)
        .select(
          'id, storage_path, shot_id, is_fix'
        )
        .single();

    if (insertError) {
      // A unique database constraint can prevent
      // simultaneous duplicate registrations.
      if (insertError.code === '23505') {
        const { data: duplicate } = await admin
          .from('turn_photos')
          .select(
            'id, storage_path, shot_id, is_fix'
          )
          .eq('turn_id', tid)
          .eq('storage_path', storagePath)
          .limit(1)
          .maybeSingle();

        if (duplicate) {
          return res.status(200).json({
            ok: true,
            alreadyRegistered: true,
            photo: duplicate,
          });
        }
      }

      throw insertError;
    }

    return res.status(201).json({
      ok: true,
      alreadyRegistered: false,
      photo: inserted,
    });
  } catch (error) {
    console.error(
      '[register-turn-photo]',
      error
    );

    return res.status(500).json({
      error: 'Unable to register photo',
    });
  }
}
