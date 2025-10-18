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

const supa = (typeof _admin === 'function' ? _admin() : _admin);
const nowIso = () => new Date().toISOString();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const turnId = String(req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing id' });

    // Support BOTH payload shapes:
    //  - new: { notes: [{ path, note }], summary?, send_sms? }
    //  - old: { photos: [{ id?, path?, note? }], overall_note?, notify? }
    const b = req.body || {};
    const summary = (b.summary ?? b.overall_note ?? '').trim();
    const notify = Boolean(b.send_sms ?? b.notify ?? true);

    // normalize into an array of { id?, path, note }
    const normalizedNotes = Array.isArray(b.notes)
      ? b.notes.map(n => ({ id: n?.id, path: String(n?.path || ''), note: String(n?.note || '') }))
      : Array.isArray(b.photos)
        ? b.photos.map(p => ({ id: p?.id, path: String(p?.path || ''), note: String(p?.note || '') }))
        : [];

    const ts = nowIso();

    // 1) Update turn status + optional overall note
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

    // 2) Flag specific photos (exact the way you had), BUT:
    //    capture the actual row(s) we updated so we can record precise findings.
    let flagged = 0;
    const attempted = [];
    const columns = ['id', 'path', 'storage_path', 'photo_path', 'url', 'file'];

    // evidence captured from real rows we touch: [{ path, area_key, note }]
    const matchedEvidence = [];

    function filenameOf(p) {
      const s = String(p || '');
      const parts = s.split('/');
      return parts[parts.length - 1] || s;
    }

    // derive the best path we can store in qa_findings to match the UI later
    function bestPathFromRow(row) {
      return (
        row?.path ||
        row?.storage_path ||
        row?.photo_path ||
        row?.url ||
        row?.file ||
        null
      );
    }

    async function updateById(table, id, note) {
      // Read the row so we can record a finding with area/path
      const { data: rows, error: selErr } = await supa
        .from(table)
        .select('id, area_key, path, storage_path, photo_path, url, file')
        .eq('id', id)
        .limit(1);
      if (selErr || !rows?.length) return false;
      const row = rows[0];

      const payload = { needs_fix: true, needs_fix_at: ts };
      if (note && String(note).trim()) payload.manager_notes = String(note).trim();

      const { error, count } = await supa
        .from(table)
        .update(payload, { count: 'exact' })
        .eq('id', id);

      if (!error && (count ?? 0) > 0) {
        const p = bestPathFromRow(row);
        if (p) matchedEvidence.push({ path: p, area_key: row?.area_key || null, note: note || '' });
        return true;
      }
      return false;
    }

    async function updateByExactPath(table, turnId, col, path, note) {
      // Select rows first so we can store their path/area_key
      const { data: rows, error: selErr } = await supa
        .from(table)
        .select(`id, area_key, ${col}, path, storage_path, photo_path, url, file`)
        .match({ turn_id: turnId, [col]: path });

      if (selErr || !Array.isArray(rows) || rows.length === 0) return false;

      const payload = { needs_fix: true, needs_fix_at: ts };
      if (note && String(note).trim()) payload.manager_notes = String(note).trim();

      const { error, count } = await supa
        .from(table)
        .update(payload, { count: 'exact' })
        .match({ turn_id: turnId, [col]: path });

      if (!error && (count ?? 0) > 0) {
        for (const r of rows) {
          const p = bestPathFromRow(r);
          if (p) matchedEvidence.push({ path: p, area_key: r?.area_key || null, note: note || '' });
        }
        return true;
      }
      return false;
    }

    async function updateByFilename(table, turnId, col, pathOrName, note) {
      const name = filenameOf(pathOrName);
      const { data, error } = await supa
        .from(table)
        .select(`id, ${col}, turn_id, area_key, path, storage_path, photo_path, url, file`)
        .eq('turn_id', turnId);

      if (error || !Array.isArray(data)) return false;
      const matches = data.filter(r => String(r[col] || '').endsWith('/' + name));
      if (matches.length === 0) return false;

      const ids = matches.map(m => m.id);
      const payload = { needs_fix: true, needs_fix_at: ts };
      if (note && String(note).trim()) payload.manager_notes = String(note).trim();

      const { error: updErr, count } = await supa
        .from(table)
        .update(payload, { count: 'exact' })
        .in('id', ids);

      if (!updErr && (count ?? 0) > 0) {
        for (const m of matches) {
          const p = bestPathFromRow(m);
          if (p) matchedEvidence.push({ path: p, area_key: m?.area_key || null, note: note || '' });
        }
        return true;
      }
      return false;
    }

    async function tryFlag(one) {
      // prefer id if provided
      if (one.id) {
        const ok = (await updateById('turn_photos', one.id, one.note))
          || (await updateById('photos', one.id, one.note));
        attempted.push({ via: 'id', id: one.id, ok });
        return ok;
      }

      // else path-based — try exact column matches first…
      if (one.path) {
        for (const table of ['turn_photos', 'photos']) {
          for (const col of columns.slice(1)) {
            const ok = await updateByExactPath(table, turnId, col, one.path, one.note);
            attempted.push({ via: `exact:${table}.${col}`, path: one.path, ok });
            if (ok) return true;
          }
        }
        // …then filename fallback
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

    // 3) Persist findings to qa_findings (use the actual rows we flagged)
    try {
      await supa.from('qa_findings').delete().eq('turn_id', turnId);

      const rowsFromMatches = matchedEvidence.map(m => ({
        turn_id: turnId,
        area_key: m.area_key || null,
        label: 'needs_fix',
        severity: 'needs_fix',
        note: (m.note || '').trim() || null,
        evidence_url: m.path,  // matches what cleaner UI will compare against
        created_at: ts,
      }));

      // Fallback: if we didn’t match anything (e.g., path didn’t find rows),
      // still write something so the cleaner has context.
      const fallback = (!rowsFromMatches.length
        ? normalizedNotes
            .filter(n => (n.path || '').trim().length > 0)
            .map(n => ({
              turn_id: turnId,
              area_key: null,
              label: 'needs_fix',
              severity: 'needs_fix',
              note: (n.note || '').trim() || null,
              evidence_url: n.path,
              created_at: ts,
            }))
        : []);

      const toInsert = rowsFromMatches.length ? rowsFromMatches : fallback;

      if (toInsert.length) {
        const { error: insErr } = await supa.from('qa_findings').insert(toInsert);
        if (insErr) console.error('insert qa_findings failed', insErr);
      }
    } catch (e) {
      console.error('qa_findings write failed', e);
      // non-fatal
    }

    // 4) Notify cleaner (optional)
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
      summary_used: Boolean(summary),
      attempted: (b.debug ? attempted : undefined),
    });
  } catch (e) {
    console.error('[api/turns/[id]/needs-fix] error', e);
    return res.status(500).json({ error: e.message || 'needs-fix failed' });
  }
}
