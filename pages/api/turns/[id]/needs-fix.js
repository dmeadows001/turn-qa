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

// Safe UUID helper (Node 18+ has globalThis.crypto.randomUUID)
const mkId = () =>
  (globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const turnId = String(req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing id' });

    // Support BOTH payload shapes the UI may send:
    //  - { notes: [{ path, note }], summary?, send_sms? }
    //  - { photos: [{ id?, path?, note? }], overall_note?, notify? }
    const b = req.body || {};
    const summary = (b.summary ?? b.overall_note ?? '').trim();
    const notify  = Boolean(b.send_sms ?? b.notify ?? true);

    const normalizedNotes = Array.isArray(b.notes)
      ? b.notes.map(n => ({ path: String(n?.path || ''), note: String(n?.note || '') }))
      : Array.isArray(b.photos)
        ? b.photos.map(p => ({ id: p?.id, path: String(p?.path || ''), note: String(p?.note || '') }))
        : [];

    const ts = nowIso();

    // --- 1) Update turn status ---
    {
      const { error } = await supa
        .from('turns')
        .update({
          status: 'needs_fix',
          needs_fix_at: ts,
          manager_note: summary || null,
        })
        .eq('id', turnId);
      if (error && !/column .* does not exist/i.test(error.message)) throw error;
    }

    // --- 2) Best-effort flagging on turn_photos/photos (non-blocking) ---
    let flagged = 0;
    const attempted = [];
    const columns = ['id', 'path', 'storage_path', 'photo_path', 'url', 'file'];

    function filenameOf(p) {
      const s = String(p || '');
      const parts = s.split('/');
      return parts[parts.length - 1] || s;
    }

    async function updateById(table, id, note) {
      const payload = { needs_fix: true, needs_fix_at: ts };
      if (note && String(note).trim()) payload.manager_notes = String(note).trim();
      const { error, count } = await supa.from(table).update(payload, { count: 'exact' }).eq('id', id);
      return !error && (count ?? 0) > 0;
    }

    async function updateByExactPath(table, turnId, col, path, note) {
      const payload = { needs_fix: true, needs_fix_at: ts };
      if (note && String(note).trim()) payload.manager_notes = String(note).trim();
      const { error, count } = await supa
        .from(table)
        .update(payload, { count: 'exact' })
        .match({ turn_id: turnId, [col]: path });
      return !error && (count ?? 0) > 0;
    }

    async function updateByFilename(table, turnId, col, pathOrName, note) {
      const name = filenameOf(pathOrName);
      const { data, error } = await supa
        .from(table)
        .select(`id, ${col}, turn_id`)
        .eq('turn_id', turnId);

      if (error || !Array.isArray(data)) return false;
      const matches = data.filter(r => String(r[col] || '').endsWith('/' + name));
      if (matches.length === 0) return false;

      let ok = false;
      for (const m of matches) {
        ok = (await updateById(table, m.id, note)) || ok;
      }
      return ok;
    }

    async function tryFlag(one) {
      if (one.id) {
        const ok = (await updateById('turn_photos', one.id, one.note))
          || (await updateById('photos', one.id, one.note));
        attempted.push({ via: 'id', id: one.id, ok });
        return ok;
      }
      if (one.path) {
        for (const table of ['turn_photos', 'photos']) {
          for (const col of columns.slice(1)) {
            const ok = await updateByExactPath(table, turnId, col, one.path, one.note);
            attempted.push({ via: `exact:${table}.${col}`, path: one.path, ok });
            if (ok) return true;
          }
        }
        for (const table of ['turn_photos', 'photos']) {
          for (const col of columns.slice(1)) {
            const ok = await updateByFilename(table, turnId, col, one.path, one.note);
            attempted.push({ via: `filename:${table}.${col}`, path: one.path, ok });
            if (ok) return true;
          }
        }
      }
      attempted.push({ via: 'none', path: one.path || null, ok: false });
      return false;
    }

    for (const n of normalizedNotes) {
      if (await tryFlag(n)) flagged++;
    }

    // --- 3) Persist findings rows so the cleaner page can highlight ---
    const findingRows = normalizedNotes
      .filter(n => (n.path || '').trim().length > 0)
      .map(n => ({
        id: mkId(),                  // ensure id always present (DB may not have default)
        turn_id: turnId,
        evidence_url: n.path,        // the cleaner UI compares against photo.path
        note: (n.note || '').trim() || null,
        severity: 'needs_fix',
        created_at: ts,
      }));

    let findingsInserted = 0;
    let findingsInsertErr = null;

    try {
      await supa.from('qa_findings').delete().eq('turn_id', turnId);

      if (findingRows.length) {
        // Use .select('id') to reliably get inserted count
        const { data: insData, error: insErr } = await supa
          .from('qa_findings')
          .insert(findingRows)
          .select('id'); // returns rows so we can count

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

        const link = `${base.replace(/\/+$/, '')}/turns/${encodeURIComponent(turnId)}/review`;
        const msg =
          `TurnQA: Updates needed${propertyName ? ` at ${propertyName}` : ''}.\n` +
          (summary ? `Note: ${summary}\n` : '') +
          (flagged > 0 ? `${flagged} item(s) marked.\n` : '') +
          `Resume here: ${link}`;
        await sendSmsMinimal(cleanerPhone, msg);
      }
    }

    return res.json({
      ok: true,
      flagged,
      findings_tried_to_insert: findingRows.length,
      findings_inserted: findingsInserted,
      findings_insert_error: findingsInsertErr, // null when all good
      summary_used: Boolean(summary),
      // attempted, // uncomment for detailed path matching trace
    });
  } catch (e) {
    console.error('[api/turns/[id]/needs-fix] error', e);
    return res.status(500).json({ error: e.message || 'needs-fix failed' });
  }
}
