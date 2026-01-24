// pages/api/turn-template.js
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
    admin.from('cleaners').select('id').eq('user_id', userId).maybeSingle(),
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

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.turnId || req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    // Auth: either manager/cleaner Supabase Bearer token OR cleaner cookie session
    const token = getBearerToken(req);
    const cleanerSess = !token ? readCleanerSession(req) : null;

    let managerId = null;
    let cleanerId = null;

    if (token) {
      const role = await resolveRoleFromBearer(token);
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

    // Authorization for this turn (admin check)
    const authz = await authorizeForTurn({ turnId, managerId, cleanerId });
    if (!authz.ok) return res.status(403).json({ error: authz.error || 'Not authorized' });

    // Query strategy:
    // - If Bearer token is present, read via RLS client
    // - If cleaner cookie session, use admin AFTER explicit authorization
    const useRls = !!token;
    const db = useRls ? createRlsClient(token) : admin;

    // 1) Turn → property_id
    const { data: turn, error: tErr } = await db
      .from('turns')
      .select('id, property_id')
      .eq('id', turnId)
      .maybeSingle();

    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Property name
    let propertyName = '';
    {
      const { data: prop, error: pErr } = await db
        .from('properties')
        .select('name')
        .eq('id', turn.property_id)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!prop) return res.status(404).json({ error: 'Property not found' });
      propertyName = prop?.name || '';
    }

    // 3) Pick template (prefer active + newest)
    const { data: tpl, error: tplErr } = await db
      .from('property_templates')
      .select('id, name, property_id, rules_text, is_active, created_at')
      .eq('property_id', turn.property_id)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tplErr) throw tplErr;

    // 4) Load shots
    let shots = [];
    if (tpl) {
      const { data: rawShots, error: sErr } = await db
        .from('template_shots')
        .select(
          'id, label, required, min_count, area_key, notes, rules_text, reference_paths, created_at'
        )
        .eq('template_id', tpl.id)
        .order('created_at', { ascending: true });
      if (sErr) throw sErr;

      shots = (rawShots || []).map((s) => ({
        shot_id: s.id,
        area_key: s.area_key || 'general',
        label: s.label || 'Photo',
        min_count: Number.isFinite(s.min_count) ? s.min_count : s.required ? 1 : 1,
        notes: s.notes || '',
        rules_text: s.rules_text || '',
        reference_paths: Array.isArray(s.reference_paths) ? s.reference_paths : s.reference_paths || [],
      }));
    }

    // Fallback defaults
    if (shots.length === 0) {
      shots = [
        { shot_id: 'default-entry', area_key: 'entry', label: 'Entry - Overall', min_count: 1, reference_paths: [] },
        { shot_id: 'default-kitchen', area_key: 'kitchen', label: 'Kitchen - Overall', min_count: 2, reference_paths: [] },
        { shot_id: 'default-bath', area_key: 'bathroom', label: 'Bathroom - Overall', min_count: 2, reference_paths: [] },
      ];
    }

    const rules = { property: propertyName, template: tpl?.name || '' };

    return res.json({
      ok: true,
      turn_id: turn.id,
      property_id: turn.property_id,
      property_name: propertyName,
      template_id: tpl?.id || null,
      rules,
      shots,
    });
  } catch (e) {
    console.error('[turn-template] error', e);
    return res.status(500).json({ error: e?.message || 'server error' });
  }
}
