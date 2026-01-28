// pages/api/turn-history.js
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

function toIso(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

function buildManagerMessage(turn) {
  // What the cleaner actually saw (preferred)
  const sent = firstNonEmpty(
    turn?.manager_note_sent,
    turn?.manager_note_translated,
    turn?.manager_note_original,
    turn?.manager_note,
    turn?.manager_notes
  );

  if (!sent) return null;

  // Best timestamp for when manager sent “needs fix”
  const at =
    toIso(turn?.needs_fix_at) ||
    toIso(turn?.submitted_at) ||
    toIso(turn?.created_at) ||
    null;

  const lang = firstNonEmpty(
    turn?.manager_note_sent_lang,
    turn?.manager_note_translated_lang,
    turn?.manager_note_original_lang
  ) || null;

  return {
    type: 'message',
    actor: 'manager',
    event: 'manager_note',
    text: sent,
    lang,
    at,
    meta: {
      original: String(turn?.manager_note_original ?? '').trim() || null,
      original_lang: String(turn?.manager_note_original_lang ?? '').trim() || null,
      translated: String(turn?.manager_note_translated ?? '').trim() || null,
      translated_lang: String(turn?.manager_note_translated_lang ?? '').trim() || null,
      sent: String(turn?.manager_note_sent ?? '').trim() || null,
      sent_lang: String(turn?.manager_note_sent_lang ?? '').trim() || null,
      legacy: String(turn?.manager_note ?? '').trim() || null,
    },
  };
}

function buildCleanerMessage(turn) {
  const sent = firstNonEmpty(
    turn?.cleaner_reply_sent,
    turn?.cleaner_reply_translated,
    turn?.cleaner_reply_original,
    turn?.cleaner_reply,
    turn?.cleaner_note
  );

  if (!sent) return null;

  const at =
    toIso(turn?.resubmitted_at) ||
    toIso(turn?.submitted_at) ||
    toIso(turn?.created_at) ||
    null;

  const lang = firstNonEmpty(
    turn?.cleaner_reply_sent_lang,
    turn?.cleaner_reply_translated_lang,
    turn?.cleaner_reply_original_lang
  ) || null;

  return {
    type: 'message',
    actor: 'cleaner',
    event: 'cleaner_reply',
    text: sent,
    lang,
    at,
    meta: {
      original: String(turn?.cleaner_reply_original ?? '').trim() || null,
      original_lang: String(turn?.cleaner_reply_original_lang ?? '').trim() || null,
      translated: String(turn?.cleaner_reply_translated ?? '').trim() || null,
      translated_lang: String(turn?.cleaner_reply_translated_lang ?? '').trim() || null,
      sent: String(turn?.cleaner_reply_sent ?? '').trim() || null,
      sent_lang: String(turn?.cleaner_reply_sent_lang ?? '').trim() || null,
      legacy: String(turn?.cleaner_reply ?? '').trim() || null,
    },
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const turnId = String(req.query.id || req.query.turnId || '').trim();
    if (!turnId) return res.status(400).json({ error: 'Missing id' });

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

    // Authorization for this turn
    const authz = await authorizeForTurn({ turnId, managerId, cleanerId });
    if (!authz.ok) return res.status(403).json({ error: authz.error || 'Not authorized' });

    // Query strategy:
    // - If Bearer token is present, read via RLS client
    // - If cleaner cookie session, use admin AFTER explicit authorization
    const useRls = !!token;
    const db = useRls ? createRlsClient(token) : admin;

    // Load turn fields needed for message reconstruction
    const { data: turn, error: turnErr } = await db
      .from('turns')
      .select([
        'id',
        'created_at',
        'submitted_at',
        'needs_fix_at',
        'approved_at',
        'resubmitted_at',
        'status',

        // legacy + new bilingual manager note fields
        'manager_note',
        'manager_notes',
        'manager_note_original',
        'manager_note_original_lang',
        'manager_note_translated',
        'manager_note_translated_lang',
        'manager_note_sent',
        'manager_note_sent_lang',

        // cleaner reply fields
        'cleaner_reply',
        'cleaner_note',
        'cleaner_reply_original',
        'cleaner_reply_original_lang',
        'cleaner_reply_translated',
        'cleaner_reply_translated_lang',
        'cleaner_reply_sent',
        'cleaner_reply_sent_lang',
      ].join(','))
      .eq('id', turnId)
      .maybeSingle();

    if (turnErr) return res.status(500).json({ error: turnErr.message });
    if (!turn) return res.status(404).json({ error: 'Not found' });

    // Load events
    const { data: events, error: evErr } = await db
      .from('turn_events')
      .select('id, turn_id, event, meta, created_at')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (evErr) return res.status(500).json({ error: evErr.message });

    const items = [];

    // 1) Turn events
    (events || []).forEach((e) => {
      items.push({
        type: 'event',
        actor: null,
        event: String(e.event || ''),
        text: '', // UI can render based on event type
        lang: null,
        at: toIso(e.created_at),
        meta: e.meta ?? null,
        id: e.id ?? null,
      });
    });

    // 2) Message-ish entries derived from turn row
    const mgrMsg = buildManagerMessage(turn);
    if (mgrMsg?.at) items.push(mgrMsg);

    const clnMsg = buildCleanerMessage(turn);
    if (clnMsg?.at) items.push(clnMsg);

    // Sort chronologically (nulls last)
    items.sort((a, b) => {
      const ta = a?.at ? new Date(a.at).getTime() : Number.POSITIVE_INFINITY;
      const tb = b?.at ? new Date(b.at).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });

    return res.status(200).json({
      ok: true,
      turn_id: turnId,
      mode: authz.mode, // 'manager' | 'cleaner'
      items,
    });
  } catch (e) {
    console.error('[turn-history] fatal', e);
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}
