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

// Manager can own a turn either via turns.manager_id OR properties.manager_id
async function authorizeManagerForTurn(turnId, managerId) {
  const { data: t, error } = await supa
    .from('turns')
    .select('id, manager_id, property_id, properties!inner(manager_id)')
    .eq('id', turnId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message || 'Turn lookup failed' };
  if (!t) return { ok: false, error: 'Turn not found' };

  const propMgr = t?.properties?.manager_id || null;

  if (t.manager_id === managerId || propMgr === managerId) {
    return { ok: true, turn: t };
  }

  return { ok: false, error: 'Not authorized (turn)' };
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

    // --- 3) Persist findings rows so the cleaner page can highlight ---
    const findingRowsBase = normalizedNotes
      .filter(n => (n.path || '').trim().length > 0)
      .map(n => ({
        id: mkId(),
        turn_id: turnId,
        evidence_url: String(n.path || '').trim(),
        note: (n.norm?.legacy_note || '').trim() || null, // legacy
        note_original: n.norm?.note_original ?? null,
        note_original_lang: n.norm?.note_original_lang ?? null,
        note_translated: n.norm?.note_translated ?? null,
        note_translated_lang: n.norm?.note_translated_lang ?? null,
        note_sent: n.norm?.note_sent ?? null,
        note_sent_lang: n.norm?.note_sent_lang ?? null,
        created_at: ts,
      }));

    const rowsWithSeverity = findingRowsBase.map(r => ({ ...r, severity: 'warn' }));

    let findingsInserted = 0;
    let findingsInsertErr = null;
    const findingsTriedToInsert = findingRowsBase.length;

    try {
      await supa.from('qa_findings').delete().eq('turn_id', turnId);

      if (rowsWithSeverity.length) {
        let { data: insData, error: insErr } = await supa
          .from('qa_findings')
          .insert(rowsWithSeverity)
          .select('id');

        if (insErr && /severity|check constraint|violates check constraint/i.test(insErr.message || '')) {
          const retry = await supa
            .from('qa_findings')
            .insert(findingRowsBase)
            .select('id');
          insData = retry.data;
          insErr = retry.error;
        }

        if (insErr && /column .* does not exist/i.test(insErr.message || '')) {
          const legacyRows = findingRowsBase.map(r => ({
            id: r.id,
            turn_id: r.turn_id,
            evidence_url: r.evidence_url,
            note: r.note,
            created_at: r.created_at,
          }));

          const legacyRowsWithSeverity = legacyRows.map(r => ({ ...r, severity: 'warn' }));
          let retry2 = await supa.from('qa_findings').insert(legacyRowsWithSeverity).select('id');

          if (retry2.error && /severity|check constraint|violates check constraint/i.test(retry2.error.message || '')) {
            retry2 = await supa.from('qa_findings').insert(legacyRows).select('id');
          }

          insData = retry2.data;
          insErr = retry2.error;
        }

        if (insErr) {
          findingsInsertErr = insErr.message || String(insErr);
          console.error('[qa_findings insert] error:', insErr);
        } else {
          findingsInserted = Array.isArray(insData) ? insData.length : 0;
        }
      }
    } catch (e) {
      findingsInsertErr = e?.message || String(e);
      console.error('[qa_findings insert] exception:', e);
    }

    // --- 4) SMS (optional) ---
    if (notify) {
      let cleanerPhone = null;
      let propertyName = null;

      const { data: t, error: tErr } = await supa
        .from('turns')
        .select('id, property_id, cleaner_id, properties(name)')
        .eq('id', turnId)
        .maybeSingle();
      if (tErr) throw tErr;

      propertyName = t?.properties?.name || null;

      if (t?.cleaner_id) {
        const { data: c } = await supa.from('cleaners').select('phone').eq('id', t.cleaner_id).maybeSingle();
        cleanerPhone = c?.phone || null;
      }
      if (!cleanerPhone && t?.property_id) {
        const { data: pc } = await supa
          .from('property_cleaners')
          .select('cleaners(phone)')
          .eq('property_id', t.property_id)
          .limit(1)
          .maybeSingle();
        cleanerPhone = pc?.cleaners?.phone || null;
      }

      if (cleanerPhone) {
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

        await sendSmsMinimal(cleanerPhone, msg);
      }
    }

    return res.json({
      ok: true,
      flagged,
      findings_tried_to_insert: findingsTriedToInsert,
      findings_inserted: findingsInserted,
      findings_insert_error: findingsInsertErr,
      summary_used: Boolean(summaryLegacy),
    });
  } catch (e) {
    console.error('[api/turns/[id]/needs-fix] error', e);
    return res.status(500).json({ error: e.message || 'needs-fix failed' });
  }
}
