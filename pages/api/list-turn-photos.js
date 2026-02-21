// pages/api/list-turn-photos.js
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { readCleanerSession } from '@/lib/session';

const admin = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function looksLikeFile(p) {
  return /\.[a-z0-9]+$/i.test(p || '');
}
function cleanPath(p) {
  return String(p || '').replace(/^\/+/, '');
}
function safePath(p) {
  const s = cleanPath(p);
  if (!s) return '';
  if (s.includes('..')) return ''; // block traversal
  return s;
}

// Create a Supabase client that enforces RLS via the caller's JWT
function createRlsClient(token) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Missing SUPABASE url/anon key');

  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// List a folder to find one file under it (latest-ish by name)
async function findOneFileUnderPrefix(prefix) {
  const folder = safePath(prefix);
  if (!folder) return null;

  const { data, error } = await admin.storage.from(BUCKET).list(folder, {
    limit: 100,
    sortBy: { column: 'name', order: 'desc' },
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const file =
    data.find((f) => /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name)) || data[0];

  return file ? `${folder}/${file.name}` : null;
}

// ✅ Match get-turn.js behavior: cleaner is resolved by phone, not by auth user id
async function resolveRoleFromBearer(token) {
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, error: 'Invalid/expired token' };

  const userId = userData.user.id;

  const authPhone =
    userData.user.phone ||
    userData.user.user_metadata?.phone ||
    null;

  const mgrPromise = admin
    .from('managers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  const clnPromise = authPhone
    ? admin
        .from('cleaners')
        .select('id')
        .eq('phone', authPhone)
        .maybeSingle()
    : Promise.resolve({ data: null });

  const [{ data: mgrRow }, { data: clnRow }] = await Promise.all([mgrPromise, clnPromise]);

  return {
    ok: true,
    userId,
    managerId: mgrRow?.id || null,
    cleanerId: clnRow?.id || null,
  };
}

async function authorizeForTurn({ turnId, managerId, cleanerId }) {
  const { data: turn, error: tErr } = await admin
    .from('turns')
    .select('id, property_id, manager_id, cleaner_id')
    .eq('id', turnId)
    .maybeSingle();

  if (tErr || !turn) return { ok: false, error: 'Turn not found' };

  // Manager owns the turn (direct)
  if (managerId && turn.manager_id === managerId) {
    return { ok: true, turn, mode: 'manager' };
  }

  // Manager owns the property (fallback)
  if (managerId && turn.property_id) {
    const { data: prop } = await admin
      .from('properties')
      .select('manager_id')
      .eq('id', turn.property_id)
      .maybeSingle();

    if (prop?.manager_id === managerId) {
      return { ok: true, turn, mode: 'manager' };
    }
  }

  // Cleaner assigned directly on the turn
  if (cleanerId && turn.cleaner_id === cleanerId) {
    return { ok: true, turn, mode: 'cleaner' };
  }

  // Cleaner assigned to property (support either cleaner_properties or property_cleaners)
  if (cleanerId && turn.property_id) {
    const [a, b] = await Promise.all([
      admin
        .from('cleaner_properties')
        .select('id')
        .eq('cleaner_id', cleanerId)
        .eq('property_id', turn.property_id)
        .maybeSingle(),
      admin
        .from('property_cleaners')
        .select('id')
        .eq('cleaner_id', cleanerId)
        .eq('property_id', turn.property_id)
        .maybeSingle(),
    ]);

    if (a?.data?.id || b?.data?.id) {
      return { ok: true, turn, mode: 'cleaner' };
    }
  }

  return { ok: false, error: 'Not authorized (turn)' };
}

async function requireManagerBillingActive(userId) {
  const { data: prof, error } = await admin
    .from('profiles')
    .select('active_until, subscription_status')
    .eq('id', userId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message || 'Billing lookup failed' };
  if (!prof) return { ok: false, error: 'Missing profile' };

  const activeUntil = prof.active_until ? new Date(prof.active_until).getTime() : 0;
  const now = Date.now();
  const isActive = activeUntil && activeUntil > now;

  if (!isActive) {
    return {
      ok: false,
      error: 'Subscription required',
      code: 'BILLING_REQUIRED',
      active_until: prof.active_until || null,
      subscription_status: prof.subscription_status || null,
    };
  }

  return { ok: true, profile: prof };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // Auth: either manager/cleaner Supabase Bearer token OR cleaner cookie session
    const token = getBearerToken(req);
    const cleanerSess = !token ? readCleanerSession(req) : null;

    let userId = null;
    let managerId = null;
    let cleanerId = null;

    if (token) {
      const role = await resolveRoleFromBearer(token);
      if (!role.ok) return res.status(401).json({ error: role.error || 'Unauthorized' });
      userId = role.userId;
      managerId = role.managerId;
      cleanerId = role.cleanerId;

      if (!managerId && !cleanerId) {
        return res.status(403).json({ error: 'Not authorized (no role)' });
      }
    } else if (cleanerSess?.cleaner_id) {
      cleanerId = cleanerSess.cleaner_id;
    } else {
      return res.status(401).json({ error: 'Missing Authorization token or cleaner session' });
    }

    // Authorization for this turn
    const authz = await authorizeForTurn({ turnId, managerId, cleanerId });
    if (!authz.ok) {
      return res.status(403).json({ error: authz.error || 'Not authorized' });
    }

    // ✅ Billing gate: managers only
    if (authz.mode === 'manager') {
      if (!userId) return res.status(401).json({ error: 'Missing user context' });

      const bill = await requireManagerBillingActive(userId);
      if (!bill.ok) {
        return res.status(402).json({
          error: bill.error || 'Subscription required',
          code: bill.code || 'BILLING_REQUIRED',
          active_until: bill.active_until || null,
          subscription_status: bill.subscription_status || null,
        });
      }
    }

    // Query strategy:
    // - If Bearer token is present, read via RLS client
    // - If cleaner cookie session, use admin AFTER explicit authorization (above)
    const useRls = !!token;
    const db = useRls ? createRlsClient(token) : admin;

    const { data: tpRows, error: tpErr } = await db
      .from('turn_photos')
      .select(
        `
        id,
        turn_id,
        shot_id,
        created_at,
        area_key,
        path,
        storage_path,
        is_fix,
        needs_fix,
        cleaner_note,
        manager_notes
      `
      )
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (tpErr) throw tpErr;

    // Lookup missing area_key via template_shots (best effort)
    const missingShotIds = Array.from(
      new Set(
        (tpRows || [])
          .filter((r) => !r.area_key && r.shot_id)
          .map((r) => String(r.shot_id))
          .filter(Boolean)
      )
    );

    let tsMap = {};
    if (missingShotIds.length) {
      const { data: tsRows, error: tsErr } = await db
        .from('template_shots')
        .select('id, area_key')
        .in('id', missingShotIds);

      if (!tsErr && Array.isArray(tsRows)) {
        tsMap = Object.fromEntries(tsRows.map((t) => [String(t.id), t.area_key || '']));
      } else if (tsErr) {
        console.warn('[list-turn-photos] template_shots lookup failed', tsErr.message || tsErr);
      }
    }

    const out = [];
    const updates = [];

    for (const r of tpRows || []) {
      const areaKey = r.area_key || tsMap[String(r.shot_id)] || '';

      const rawPath = r.path || r.storage_path || '';
      let objPath = safePath(rawPath);
      if (!objPath) objPath = safePath(`turns/${turnId}/${r.shot_id || ''}`.replace(/\/+$/, ''));

      let finalPath = objPath;
      let signedUrl = '';

      try {
        if (finalPath && !looksLikeFile(finalPath)) {
          const found = await findOneFileUnderPrefix(finalPath);
          if (found) {
            finalPath = found;
            if (r.id) updates.push({ id: r.id, path: finalPath });
          }
        }

        if (finalPath && looksLikeFile(finalPath)) {
          const { data: s, error: sErr } = await admin.storage
            .from(BUCKET)
            .createSignedUrl(finalPath, 60 * 60);
          if (!sErr) signedUrl = s?.signedUrl || '';
        }
      } catch (e) {
        console.warn('[list-turn-photos] signing/list error for', objPath, e?.message || e);
      }

      out.push({
        id: r.id,
        turn_id: r.turn_id,
        shot_id: r.shot_id,
        path: finalPath,
        created_at: r.created_at,
        area_key: areaKey,
        signedUrl,
        is_fix: r.is_fix ?? undefined,
        needs_fix: r.needs_fix ?? undefined,
        cleaner_note: r.cleaner_note ?? undefined,
        manager_note: r.manager_notes ?? undefined,
      });
    }

    // Best-effort backfill path updates via admin (only after authorization)
    if (updates.length) {
      try {
        await Promise.all(
          updates.map((u) =>
            admin
              .from('turn_photos')
              .update({
                path: u.path,
                // If your schema doesn't have storage_path, remove this line.
                storage_path: u.path,
              })
              .eq('id', u.id)
          )
        );
      } catch (e) {
        console.warn('[list-turn-photos] backfill update failed', e?.message || e);
      }
    }

    // Do NOT dedupe — return everything, oldest -> newest
    const finalOut = out.slice().sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return ta - tb;
    });

    return res.json({ photos: finalOut });
  } catch (e) {
    console.error('[list-turn-photos] error', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
