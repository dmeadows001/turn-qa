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

function cleanStr(v) {
  const s = String(v ?? '').trim();
  return s ? s : '';
}

function cleanLang(v) {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

/**
 * Build a message object that ALWAYS includes:
 * - text = "sent" (what the receiver saw)
 * - text_sent/text_sent_lang
 * - text_original/text_original_lang
 * - text_translated/text_translated_lang
 * and keeps meta for debugging/compat.
 */
function makeMessageBase({ actor, event, at, original, original_lang, translated, translated_lang, sent, sent_lang, legacy }) {
  const o = cleanStr(original);
  const t = cleanStr(translated);
  const s = cleanStr(sent);
  const l = cleanStr(legacy);

  // Determine what "text" should be (prefer "sent", then translated, then original, then legacy)
  const text = firstNonEmpty(s, t, o, l);

  return {
    type: 'message',
    actor,
    event,
    at: at || null,

    // Keep existing keys
    text,
    lang: cleanLang(sent_lang || translated_lang || original_lang),

    // NEW: explicit bilingual keys (top-level, easy for UI)
    text_sent: s || null,
    text_sent_lang: cleanLang(sent_lang),
    text_original: o || null,
    text_original_lang: cleanLang(original_lang),
    text_translated: t || null,
    text_translated_lang: cleanLang(translated_lang),

    // Keep meta (backward compat + debugging)
    meta: {
      original: o || null,
      original_lang: cleanLang(original_lang),
      translated: t || null,
      translated_lang: cleanLang(translated_lang),
      sent: s || null,
      sent_lang: cleanLang(sent_lang),
      legacy: l || null,
    },
  };
}

function buildManagerMessage(turn) {
  // Prefer explicit "sent" (what cleaner saw), then translated, then original, then legacy
  const sent = firstNonEmpty(turn?.manager_note_sent, turn?.manager_note_translated, turn?.manager_note_original, turn?.manager_note, turn?.manager_notes);
  if (!sent) return null;

  const at =
    toIso(turn?.needs_fix_at) ||
    toIso(turn?.submitted_at) ||
    toIso(turn?.created_at) ||
    null;

  return makeMessageBase({
    actor: 'manager',
    event: 'manager_note',
    at,
    original: turn?.manager_note_original,
    original_lang: turn?.manager_note_original_lang,
    translated: turn?.manager_note_translated,
    translated_lang: turn?.manager_note_translated_lang,
    sent: turn?.manager_note_sent || turn?.manager_note_translated || turn?.manager_note_original || turn?.manager_note || turn?.manager_notes,
    sent_lang: turn?.manager_note_sent_lang || turn?.manager_note_translated_lang || turn?.manager_note_original_lang,
    legacy: turn?.manager_note,
  });
}

function buildCleanerMessage(turn) {
  const sent = firstNonEmpty(turn?.cleaner_reply_sent, turn?.cleaner_reply_translated, turn?.cleaner_reply_original, turn?.cleaner_reply, turn?.cleaner_note);
  if (!sent) return null;

  const at =
    toIso(turn?.resubmitted_at) ||
    toIso(turn?.submitted_at) ||
    toIso(turn?.created_at) ||
    null;

  return makeMessageBase({
    actor: 'cleaner',
    event: 'cleaner_reply',
    at,
    original: turn?.cleaner_reply_original,
    original_lang: turn?.cleaner_reply_original_lang,
    translated: turn?.cleaner_reply_translated,
    translated_lang: turn?.cleaner_reply_translated_lang,
    sent: turn?.cleaner_reply_sent || turn?.cleaner_reply_translated || turn?.cleaner_reply_original || turn?.cleaner_reply || turn?.cleaner_note,
    sent_lang: turn?.cleaner_reply_sent_lang || turn?.cleaner_reply_translated_lang || turn?.cleaner_reply_original_lang,
    legacy: turn?.cleaner_reply,
  });
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
    if (!authz.ok) return res.status(403).json({ error: authz.error || 'Not authorized' });

    // ✅ Billing gate: managers only (cleaners are never blocked)
if (authz.mode === 'manager') {
  if (!userId) {
    return res.status(401).json({ error: 'Missing user context' });
  }

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

        // NEW fields present but null (so UI can treat uniformly)
        text_sent: null,
        text_sent_lang: null,
        text_original: null,
        text_original_lang: null,
        text_translated: null,
        text_translated_lang: null,

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
