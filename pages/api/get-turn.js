// pages/api/get-turn.js
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { readCleanerSession } from '@/lib/session';

const admin = typeof _admin === 'function' ? _admin() : _admin;

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
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

async function resolveRoleFromBearer(token) {
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, error: 'Invalid/expired token' };

  const userId = userData.user.id;

  const [{ data: mgrRow }, { data: clnRow }] = await Promise.all([
    admin.from('managers').select('id').eq('user_id', userId).maybeSingle(),
    admin.from('cleaners').select('id').eq('id', userId).maybeSingle(),
  ]);

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

  // Manager owns the turn
  if (managerId && turn.manager_id === managerId) return { ok: true, turn, mode: 'manager' };

  // Cleaner assigned directly on the turn
  if (cleanerId && turn.cleaner_id === cleanerId) return { ok: true, turn, mode: 'cleaner' };

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

    if (a?.data?.id || b?.data?.id) return { ok: true, turn, mode: 'cleaner' };
  }

  return { ok: false, error: 'Not authorized (turn)' };
}

async function requireManagerBillingActive(userId) {
  // profiles.id is your Supabase auth user id (uuid)
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
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const turnId = String(req.query.id || req.query.turnId || '').trim();
    if (!turnId) return res.status(400).json({ error: 'Missing id' });

    // Auth: either manager/cleaner Supabase Bearer token OR cleaner cookie session
    const token = getBearerToken(req);
    const cleanerSess = !token ? readCleanerSession(req) : null;

    let userId = null;
    let managerId = null;
    let cleanerId = null;


    if (token) {
      const role = await resolveRoleFromBearer(token);
      userId = role.userId;
      if (!role.ok) return res.status(401).json({ error: role.error || 'Unauthorized' });

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
    if (!authz.ok) return res.status(403).json({ error: authz.error || 'Not authorized' });

    // ✅ Billing gate: only for managers (cleaners are not blocked)
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
    // - If cleaner cookie session, use admin AFTER explicit authorization
    const useRls = !!token;
    const db = useRls ? createRlsClient(token) : admin;

    const { data: turn, error } = await db.from('turns').select('*').eq('id', turnId).maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!turn) return res.status(404).json({ error: 'Not found' });

    return res.status(200).json({ turn });
  } catch (e) {
    console.error('[get-turn] fatal', e);
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}
