// pages/api/turns/[id]/needs-fix.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

let sendSmsMinimal = async () => {};
try {
  ({ sendSmsMinimal } = require('@/lib/sms'));
} catch {
  const hasTwilio =
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER;
  if (hasTwilio) {
    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    sendSmsMinimal = async (to, body) => {
      try {
        await twilio.messages.create({
          to,
          from: process.env.TWILIO_FROM_NUMBER,
          body,
        });
      } catch (e) {
        // Keep original behavior: log + swallow
        console.error('[needs-fix sms] twilio error', e?.message || e);
      }
    };
  }
}

// IMPORTANT: supabaseAdmin is a factory function in this repo
const supa = typeof _admin === 'function' ? _admin() : _admin;
const nowIso = () => new Date().toISOString();

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function requireManagerFromBearer(token) {
  const { data: userData, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, error: 'Invalid/expired token' };

  const userId = userData.user.id;

  const { data: mgrRow, error: mgrErr } = await supa
    .from('managers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (mgrErr) return { ok: false, error: mgrErr.message || 'Manager lookup failed' };
  if (!mgrRow?.id) return { ok: false, error: 'Not authorized (manager only)' };

  return { ok: true, userId, managerId: mgrRow.id };
}

// Only the current property owner may request turnover fixes.
// A historical turns.manager_id must not override property ownership.
async function authorizeManagerForTurn(turnId, managerId) {
  const { data: turn, error: turnErr } = await supa
    .from('turns')
    .select('id, property_id')
    .eq('id', turnId)
    .maybeSingle();

  if (turnErr) {
    return { ok: false, error: turnErr.message || 'Turn lookup failed' };
  }

  if (!turn) {
    return { ok: false, error: 'Turn not found' };
  }

  const { data: property, error: propErr } = await supa
    .from('properties')
    .select('id')
    .eq('id', turn.property_id)
    .eq('manager_id', managerId)
    .maybeSingle();

  if (propErr) {
    return { ok: false, error: propErr.message || 'Property lookup failed' };
  }

  if (!property) {
    return { ok: false, error: 'Not authorized (turn)' };
  }

  return { ok: true, turn };
}

async function requireManagerBillingActive(userId) {
  const { data: prof, error } = await supa
    .from('profiles')
    .select('active_until, subscription_status')
    .eq('id', userId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message || 'Billing lookup failed' };
  if (!prof) return { ok: false, error: 'Missing profile' };

  const activeUntil = prof.active_until ? new Date(prof.active_until).getTime() : 0;
  const now = Date.now();

  if (!activeUntil || activeUntil <= now) {
    return {
      ok: false,
      error: 'Subscription required',
      code: 'BILLING_REQUIRED',
      active_until: prof.active_until || null,
      subscription_status: prof.subscription_status || null,
    };
  }

  return { ok: true };
}

// simple id helper (Node 18+ has crypto.randomUUID)
const mkId = () =>
  (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
    ? globalThis.crypto.randomUUID()
    : `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function filenameOf(p) {
  const s = String(p || '');
  const parts = s.split('/');
  return parts[parts.length - 1] || s;
}

// Normalize note payload:
// - old: note is string
// - new: note can be object { original, translated, sent, original_lang, translated_lang, sent_lang }
function normalizeNotePayload(note) {
  const raw = note;

  if (raw && typeof raw === 'object') {
    const original = String(raw.original ?? '').trim();
    const translated = String(raw.translated ?? '').trim();
    const sent = String(raw.sent ?? (translated || original || '')).trim();

    const original_lang = String(raw.original_lang ?? raw.originalLang ?? '').trim() || null;
    const translated_lang = String(raw.translated_lang ?? raw.translatedLang ?? '').trim() || null;
    const sent_lang = String(raw.sent_lang ?? raw.sentLang ?? '').trim() || null;

    const legacy = sent || original || translated || '';

    return {
      legacy_note: legacy,
      manager_note_original: original || null,
      manager_note_original_lang: original_lang,
      manager_note_translated: translated || null,
      manager_note_translated_lang: translated_lang,
      manager_note_sent: sent || null,
      manager_note_sent_lang: sent_lang,

      // for qa_findings naming
      note_original: original || null,
      note_original_lang: original_lang,
      note_translated: translated || null,
      note_translated_lang: translated_lang,
      note_sent: sent || null,
      note_sent_lang: sent_lang,
    };
  }

  const s = String(raw ?? '').trim();
  return {
    legacy_note: s,
    manager_note_original: s || null,
    manager_note_original_lang: null,
    manager_note_translated: null,
    manager_note_translated_lang: null,
    manager_note_sent: s || null,
    manager_note_sent_lang: null,

    note_original: s || null,
    note_original_lang: null,
    note_translated: null,
    note_translated_lang: null,
    note_sent: s || null,
    note_sent_lang: null,
  };
}

function buildNormFromRow(row) {
  // If note is already an object, use existing behavior
  if (row?.note && typeof row.note === 'object') {
    return normalizeNotePayload(row.note);
  }

  // If bilingual fields are present at top-level, map them into the object shape
  const hasBilingual =
    row?.note_original != null ||
    row?.note_translated != null ||
    row?.note_original_lang != null ||
    row?.note_translated_lang != null ||
    row?.note_sent != null ||
    row?.note_sent_lang != null;

  if (hasBilingual) {
    const original = String(row?.note_original ?? '').trim();
    const translated = String(row?.note_translated ?? '').trim();

    // What cleaner sees (preferred): note_sent, else note (legacy), else translated/original
    const sent = String(
      row?.note_sent ??
      row?.note ??
      (translated || original || '')
    ).trim();

    const original_lang = String(row?.note_original_lang ?? '').trim() || null;
    const translated_lang = String(row?.note_translated_lang ?? '').trim() || null;
    const sent_lang = String(row?.note_sent_lang ?? '').trim() || null;

    return normalizeNotePayload({
      original,
      translated,
      sent,
      original_lang,
      translated_lang,
      sent_lang,
    });
  }

  // Fallback: treat note as legacy string
  return normalizeNotePayload(row?.note);
}

function buildTurnPhotoUpdatePayload(ts, norm) {
  const payload = { needs_fix: true, needs_fix_at: ts };

  // legacy
  if (norm?.legacy_note && String(norm.legacy_note).trim()) {
    payload.manager_notes = String(norm.legacy_note).trim();
  }

  // new bilingual columns
  payload.manager_note_original = norm?.manager_note_original ?? null;
  payload.manager_note_original_lang = norm?.manager_note_original_lang ?? null;
  payload.manager_note_translated = norm?.manager_note_translated ?? null;
  payload.manager_note_translated_lang = norm?.manager_note_translated_lang ?? null;
  payload.manager_note_sent = norm?.manager_note_sent ?? null;
  payload.manager_note_sent_lang = norm?.manager_note_sent_lang ?? null;

  return payload;
}

function buildLegacyPhotoUpdatePayload(ts, norm) {
  const payload = { needs_fix: true, needs_fix_at: ts };
  if (norm?.legacy_note && String(norm.legacy_note).trim()) {
    payload.manager_notes = String(norm.legacy_note).trim();
  }
  return payload;
}

async function updateById(table, id, payload) {
  const { error, count } = await supa.from(table).update(payload, { count: 'exact' }).eq('id', id);
  return !error && (count ?? 0) > 0;
}

async function updateByExactMatch(table, matchObj, payload) {
  const { error, count } = await supa.from(table).update(payload, { count: 'exact' }).match(matchObj);
  return !error && (count ?? 0) > 0;
}

/**
 * Minimal phone validation for Twilio "To" param.
 * - Must be E.164-ish: + then 8-15 digits (Twilio accepts E.164)
 */
function normalizeE164(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  // allow spaces/dashes/parentheses and strip them, but keep leading +
  const cleaned = s.startsWith('+')
    ? '+' + s.slice(1).replace(/[^\d]/g, '')
    : s.replace(/[^\d]/g, '');
  return cleaned;
}

function isLikelyE164(input) {
  const s = String(input ?? '').trim();
  // must start with + and be 8-15 digits total after +
  return /^\+\d{8,15}$/.test(s);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const turnId = String(req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing id' });

    // ✅ Option A: manager-only + must be paid/trial active
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Missing Authorization token' });

    const mgr = await requireManagerFromBearer(token);
    if (!mgr.ok) return res.status(403).json({ error: mgr.error || 'Forbidden' });

    const authz = await authorizeManagerForTurn(turnId, mgr.managerId);
    if (!authz.ok) return res.status(403).json({ error: authz.error || 'Not authorized' });

    const bill = await requireManagerBillingActive(mgr.userId);
    if (!bill.ok) {
      return res.status(402).json({
        error: bill.error || 'Subscription required',
        code: bill.code || 'BILLING_REQUIRED',
        active_until: bill.active_until || null,
        subscription_status: bill.subscription_status || null,
      });
    }

    // Support BOTH payload shapes the UI may send:
    //  - { notes: [{ path, note, photo_id? }], summary?, send_sms? }
    //  - { photos: [{ id?, path?, note? }], overall_note?, notify? }
    const b = req.body || {};

    // --- SUMMARY: can be string OR bilingual object ---
    const summaryRaw = b.summary ?? b.overall_note ?? '';
    const summaryNorm = normalizeNotePayload(summaryRaw);
    const summaryLegacy = String(summaryNorm.legacy_note || '').trim();
    const notify = Boolean(b.send_sms ?? b.notify ?? true);

    const normalizedNotes = Array.isArray(b.notes)
      ? b.notes.map(n => ({
          photo_id: n?.photo_id ?? n?.photoId ?? null,
          path: String(n?.path || ''),
          norm: buildNormFromRow(n),
        }))
      : Array.isArray(b.photos)
        ? b.photos.map(p => ({
            photo_id: p?.id ?? null,
            path: String(p?.path || ''),
            norm: buildNormFromRow(p),
          }))
        : [];

    const ts = nowIso();

    // --- 1) Update turn status (dual-write: legacy + new) ---
    {
      const payload = {
        status: 'needs_fix',
        needs_fix_at: ts,

        // legacy: always store what the cleaner should see (sent)
        manager_note: summaryLegacy || null,

        // new bilingual summary fields
        manager_note_original: summaryNorm.manager_note_original ?? null,
        manager_note_original_lang: summaryNorm.manager_note_original_lang ?? null,
        manager_note_translated: summaryNorm.manager_note_translated ?? null,
        manager_note_translated_lang: summaryNorm.manager_note_translated_lang ?? null,
        manager_note_sent: summaryNorm.manager_note_sent ?? (summaryLegacy || null),
        manager_note_sent_lang: summaryNorm.manager_note_sent_lang ?? null,
      };

      const { error } = await supa.from('turns').update(payload).eq('id', turnId);

      // If your DB is missing new columns, don’t fail the whole request.
      if (error) {
        if (/column .* does not exist/i.test(error.message || '')) {
          const { error: e2 } = await supa
            .from('turns')
            .update({
              status: 'needs_fix',
              needs_fix_at: ts,
              manager_note: summaryLegacy || null,
            })
            .eq('id', turnId);
          if (e2) throw e2;
        } else {
          throw error;
        }
      }
    }

    // --- 2) Best-effort flagging on turn_photos/photos (non-blocking) ---
    let flagged = 0;
    const columns = ['path', 'storage_path', 'photo_path', 'url', 'file'];

    async function tryFlag(one) {
      const path = String(one.path || '').trim();
      const photoId = one.photo_id || null;
      const norm = one.norm || normalizeNotePayload('');

      // Prefer: turn_photos by ID
      if (photoId) {
        try {
          const ok = await updateById('turn_photos', photoId, buildTurnPhotoUpdatePayload(ts, norm));
          if (ok) return true;
        } catch (e) {
          if (/column .* does not exist/i.test(String(e?.message || e))) {
            const ok = await updateById('turn_photos', photoId, buildLegacyPhotoUpdatePayload(ts, norm));
            if (ok) return true;
          }
        }

        // legacy photos table
        try {
          const ok2 = await updateById('photos', photoId, buildLegacyPhotoUpdatePayload(ts, norm));
          if (ok2) return true;
        } catch {}
      }

      // Next: exact path match
      if (path) {
        for (const col of columns) {
          try {
            const ok = await updateByExactMatch(
              'turn_photos',
              { turn_id: turnId, [col]: path },
              buildTurnPhotoUpdatePayload(ts, norm)
            );
            if (ok) return true;
          } catch (e) {
            if (/column .* does not exist/i.test(String(e?.message || e))) {
              const ok = await updateByExactMatch(
                'turn_photos',
                { turn_id: turnId, [col]: path },
                buildLegacyPhotoUpdatePayload(ts, norm)
              );
              if (ok) return true;
            }
          }

          try {
            const ok2 = await updateByExactMatch(
              'photos',
              { turn_id: turnId, [col]: path },
              buildLegacyPhotoUpdatePayload(ts, norm)
            );
            if (ok2) return true;
          } catch {}
        }

        // Last resort: filename match
        const fname = filenameOf(path);
        for (const table of ['turn_photos', 'photos']) {
          for (const col of columns) {
            try {
              const { data, error } = await supa
                .from(table)
                .select(`id, ${col}, turn_id`)
                .eq('turn_id', turnId);

              if (error || !Array.isArray(data)) continue;

              const matches = data.filter(r => String(r[col] || '').endsWith('/' + fname));
              if (!matches.length) continue;

              let anyOk = false;
              for (const m of matches) {
                if (table === 'turn_photos') {
                  try {
                    const ok = await updateById('turn_photos', m.id, buildTurnPhotoUpdatePayload(ts, norm));
                    anyOk = ok || anyOk;
                  } catch (e) {
                    if (/column .* does not exist/i.test(String(e?.message || e))) {
                      const ok = await updateById('turn_photos', m.id, buildLegacyPhotoUpdatePayload(ts, norm));
                      anyOk = ok || anyOk;
                    }
                  }
                } else {
                  const ok = await updateById('photos', m.id, buildLegacyPhotoUpdatePayload(ts, norm));
                  anyOk = ok || anyOk;
                }
              }
              if (anyOk) return true;
            } catch {}
          }
        }
      }

      return false;
    }

    for (const n of normalizedNotes) {
      try {
        if (await tryFlag(n)) flagged++;
      } catch {}
    }

    // --- 3) Append a review round; never delete historical findings ---
    // The new rows are staged inactive until every insert succeeds.
    // This avoids leaving the cleaner with a partial active round.
    const { data: priorFindings, error: priorErr } = await supa
      .from('qa_findings')
      .select('id, photo_id, evidence_url, review_round, is_active, correction_task_id')
      .eq('turn_id', turnId);
    if (priorErr) throw priorErr;

    const previousRound = (priorFindings || []).reduce(
      (max, row) => Math.max(max, Number(row.review_round) || 1), 0
    );
    const reviewRound = previousRound + 1;
    const previousActive = (priorFindings || []).filter(r => r.is_active);
    const previousActiveIds = previousActive.map(r => r.id);

    // Resolve selected photos to a stable task. A prior finding's own ID is
    // the fallback task ID for records created before the schema migration.
    // Only the latest active findings can be carried into a new round.
    const { data: selectedPhotos, error: selectedErr } = await supa
      .from('turn_photos')
      .select('id, shot_id, path, storage_path, is_fix, correction_task_id')
      .eq('turn_id', turnId);
    if (selectedErr) throw selectedErr;

    // Look up the prior active finding's photo and checklist item. This is
    // needed only for old correction photos that predate correction_task_id.
    const activePhotoIds = previousActive.map(f => f.photo_id).filter(Boolean);
    let activePhotos = [];
    if (activePhotoIds.length) {
      const { data, error } = await supa.from('turn_photos')
        .select('id, shot_id').eq('turn_id', turnId).in('id', activePhotoIds);
      if (error) throw error;
      activePhotos = data || [];
    }
    const selectedById = new Map((selectedPhotos || []).map(p => [String(p.id), p]));
    const selectedByPath = new Map();
    for (const p of selectedPhotos || []) {
      if (p.path) selectedByPath.set(p.path, p);
      if (p.storage_path) selectedByPath.set(p.storage_path, p);
    }
    const activeShotById = new Map(activePhotos.map(p => [String(p.id), p.shot_id]));

    function taskForSelection(n) {
      const photo = selectedById.get(String(n.photo_id || '')) || selectedByPath.get(n.path);
      if (!photo) throw new Error('Selected photo could not be verified; refresh and retry');
      const directTask = photo.correction_task_id || null;
      if (directTask) return directTask;

      // If a manager re-rejects the exact same photo, retain its task.
      const exact = previousActive.filter(f =>
        (f.photo_id && String(f.photo_id) === String(photo.id)) ||
        (f.evidence_url && (f.evidence_url === photo.path || f.evidence_url === photo.storage_path))
      );
      if (exact.length === 1) return exact[0].correction_task_id || exact[0].id;

      // Legacy correction uploads lack a task ID. Match by checklist item
      // ONLY when exactly one active task occupies that item. Never guess
      // when multiple issues share a shot.
      if (photo.is_fix && photo.shot_id) {
        const candidates = previousActive.filter(f => activeShotById.get(String(f.photo_id)) === photo.shot_id);
        if (candidates.length === 1) return candidates[0].correction_task_id || candidates[0].id;
        if (candidates.length > 1) throw new Error(
          'This correction could match multiple outstanding issues in the same checklist item. Link it to a task before rejecting it again.'
        );
      }
      return null; // First rejection: create a new task below.
    }

    const findingRowsBase = normalizedNotes
      .filter(n => (n.path || '').trim().length > 0)
      .map(n => {
        const id = mkId();
        return {
          id,
          turn_id: turnId,
          photo_id: n.photo_id || null,
          evidence_url: String(n.path || '').trim(),
          correction_task_id: taskForSelection(n) || id,
          note: (n.norm?.legacy_note || '').trim() || null,
          note_original: n.norm?.note_original ?? null,
          note_original_lang: n.norm?.note_original_lang ?? null,
          note_translated: n.norm?.note_translated ?? null,
          note_translated_lang: n.norm?.note_translated_lang ?? null,
          note_sent: n.norm?.note_sent ?? null,
          note_sent_lang: n.norm?.note_sent_lang ?? null,
          created_at: ts,
          review_round: reviewRound,
          is_active: false,
        };
      });

    const newIds = findingRowsBase.map(r => r.id);
    let findingsInserted = 0;
    let findingsInsertErr = null;
    const findingsTriedToInsert = findingRowsBase.length;

    try {
      if (findingRowsBase.length) {
        const withSeverity = findingRowsBase.map(r => ({ ...r, severity: 'warn' }));
        let { error: insErr } = await supa.from('qa_findings').insert(withSeverity);
        if (insErr && /severity|check constraint|violates check constraint/i.test(insErr.message || '')) {
          ({ error: insErr } = await supa.from('qa_findings').insert(findingRowsBase));
        }
        if (insErr) throw insErr;
        findingsInserted = findingRowsBase.length;
      }

      // Close the prior round only after the new records have been stored.
      if (previousActiveIds.length) {
        const { error: closeErr } = await supa.from('qa_findings')
          .update({ is_active: false }).in('id', previousActiveIds);
        if (closeErr) throw closeErr;
      }
      if (newIds.length) {
        const { error: activateErr } = await supa.from('qa_findings')
          .update({ is_active: true }).in('id', newIds);
        if (activateErr) throw activateErr;
      }
    } catch (err) {
      // Best-effort compensation; a DB transaction/RPC is the stronger long-term solution.
      if (newIds.length) await supa.from('qa_findings').delete().in('id', newIds);
      if (previousActiveIds.length) {
        await supa.from('qa_findings').update({ is_active: true }).in('id', previousActiveIds);
      }
      throw new Error(`Could not save review round: ${err?.message || err}`);
    }

    // --- 4) SMS (optional) ---
    if (notify) {
      let cleanerPhone = null;
      let propertyName = null;
      let cleanerId = null;
      let propertyId = null;

      const { data: t, error: tErr } = await supa
        .from('turns')
        .select('id, property_id, cleaner_id, properties(name)')
        .eq('id', turnId)
        .maybeSingle();
      if (tErr) throw tErr;

      propertyName = t?.properties?.name || null;
      cleanerId = t?.cleaner_id || null;
      propertyId = t?.property_id || null;

      if (cleanerId) {
        const { data: c } = await supa.from('cleaners').select('phone').eq('id', cleanerId).maybeSingle();
        cleanerPhone = c?.phone || null;
      }
      if (!cleanerPhone && propertyId) {
        const { data: pc } = await supa
          .from('property_cleaners')
          .select('cleaners(phone)')
          .eq('property_id', propertyId)
          .limit(1)
          .maybeSingle();
        cleanerPhone = pc?.cleaners?.phone || null;
      }

      // ✅ NEW LOGS (and a hard fail) — BEFORE calling Twilio
      const rawPhone = cleanerPhone;
      const cleaned = normalizeE164(rawPhone);

      console.log('[needs-fix] sms debug', {
        turnId,
        propertyId,
        cleanerId,
        propertyName,
        rawPhone,
        cleaned,
        hasTwilioEnv: Boolean(
          process.env.TWILIO_ACCOUNT_SID &&
          process.env.TWILIO_AUTH_TOKEN &&
          process.env.TWILIO_FROM_NUMBER
        ),
      });

      // A notification failure must not make a saved review appear unsaved.
      if (!cleaned || !isLikelyE164(cleaned)) {
        console.warn('[needs-fix] review saved, SMS skipped: invalid cleaner phone');
      } else {
      const base =
        process.env.APP_BASE_URL ||
        process.env.NEXT_PUBLIC_APP_BASE_URL ||
        process.env.NEXT_PUBLIC_SITE_URL ||
        'https://www.turnqa.com';

      const link = `${base.replace(/\/+$/, '')}/turns/${encodeURIComponent(turnId)}/capture?tab=needs-fix`;

      const msg =
        `TurnQA: Updates needed${propertyName ? ` at ${propertyName}` : ''}.\n` +
        (summaryLegacy ? `Note: ${summaryLegacy}\n` : '') +
        (flagged > 0 ? `${flagged} item(s) marked.\n` : '') +
        `Resume here: ${link}`;

      // Support both implementations:
      // - sendSmsMinimal(to, body)
      // - sendSmsMinimal({ to, body })
      try {
        await sendSmsMinimal({ to: cleaned, body: msg });
      } catch (e1) {
        // fallback for old signature
        try { await sendSmsMinimal(cleaned, msg); }
        catch (e2) { console.error('[needs-fix] SMS failed after review saved', e2); }
      }
      }
    }

    return res.json({
      ok: true,
      flagged,
      findings_tried_to_insert: findingsTriedToInsert,
      findings_inserted: findingsInserted,
      findings_insert_error: findingsInsertErr,
      review_round: reviewRound,
      summary_used: Boolean(summaryLegacy),
    });
  } catch (e) {
    console.error('[api/turns/[id]/needs-fix] error', e);
    return res.status(500).json({ error: e.message || 'needs-fix failed' });
  }
}
