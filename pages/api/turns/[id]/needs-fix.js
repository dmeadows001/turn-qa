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

const supa = typeof _admin === 'function' ? _admin() : _admin;
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

    // normalize into an array of { path, note }
    const normalizedNotes = Array.isArray(b.notes)
      ? b.notes.map(n => ({ path: String(n?.path || ''), note: String(n?.note || '') }))
      : Array.isArray(b.photos)
        ? b.photos.map(p => ({ path: String(p?.path || ''), note: String(p?.note || '') }))
        : [];

    const ts = nowIso();

    // 1) Set turn status + optional overall note
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

    // 2) Try to flag specific photos (your existing logic kept intact)
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

    // 3) Persist findings to qa_findings for the cleaner UI highlight
    try {
      // optional: clear any previous findings for this turn so they don’t pile up
      await supa.from('qa_findings').delete().eq('turn_id', turnId);

      const rows = normalizedNotes
        .filter(n => (n.path || '').trim().length > 0)
        .map(n => ({
          turn_id: turnId,
          evidence_url: n.path,               // UI compares this against photo `path`
          note: (n.note || '').trim() || null,
          severity: 'needs_fix',              // keep simple; adjust if you add enum later
          created_at: ts,
        }));

      if (rows.length) {
        const { error: insErr } = await supa.from('qa_findings').insert(rows);
        if (insErr) console.error('insert qa_findings failed', insErr);
      }
    } catch (e) {
      console.error('qa_findings write failed', e);
      // non-fatal
    }

    // 4) Notify cleaner (optional)
    if (notify) {
      // find cleaner phone
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
