// pages/api/turns/[id]/needs-fix.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

let sendSmsMinimal = async () => {};
try {
  ({ sendSmsMinimal } = require('@/lib/sms'));
} catch (_) {
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
        // eslint-disable-next-line no-console
        console.error('[needs-fix sms] twilio error', e?.message || e);
      }
    };
  }
}

const supa = typeof _admin === 'function' ? _admin() : _admin;
const nowIso = () => new Date().toISOString();

// Try to persist a per-photo note if the table exists.
// We keep it tolerant to schema differences and fail-soft.
async function tryInsertFixNote({ turn_id, photo_path = null, photo_id = null, note = '' }) {
  try {
    // Common column set: turn_id, photo_path, photo_id, note, created_at
    const row = {
      turn_id,
      note: note || null,
      created_at: nowIso(),
    };
    if (photo_path) row.photo_path = photo_path;
    if (photo_id) row.photo_id = photo_id;

    const { error } = await supa.from('turn_fix_notes').insert(row);
    if (error) {
      // If table/column mismatch, just ignore (stay fail-soft)
      if (!/does not exist|invalid input/i.test(error.message)) {
        // eslint-disable-next-line no-console
        console.warn('[needs-fix] turn_fix_notes insert warning:', error.message);
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[needs-fix] turn_fix_notes insert error:', e?.message || e);
  }
}

// Update per-photo flags on a table by id or path; tolerant to column spellings.
async function flagPhotoOnTable(table, turnId, match, ts) {
  const payload = { needs_fix: true, needs_fix_at: ts };

  if (typeof match.note === 'string' && match.note.trim()) {
    // Many schemas use manager_note(s); set both if present—extra keys are ignored by Supabase if they don’t exist.
    payload.manager_note = match.note.trim();
    payload.manager_notes = match.note.trim();
  }

  // by internal id
  if (match.id) {
    const { data, error } = await supa
      .from(table)
      .update(payload)
      .eq('id', match.id)
      .select('id, path, storage_path, photo_path, url')
      .maybeSingle();
    if (!error && data) {
      const path =
        data.path || data.storage_path || data.photo_path || data.url || null;
      await tryInsertFixNote({ turn_id: turnId, photo_id: data.id, photo_path: path, note: match.note || '' });
      return true;
    }
    return false;
  }

  // by storage path
  if (match.path) {
    const candidates = ['path', 'storage_path', 'photo_path', 'url', 'file'];
    for (const col of candidates) {
      const { data, error } = await supa
        .from(table)
        .update(payload)
        .match({ turn_id: turnId, [col]: match.path })
        .select('id') // return updated rows
        .maybeSingle(); // we only need to know if at least one row matched

      // If single-select didn’t find, try a broad update with count for multiple rows:
      if (error) {
        // try a counted update for multiple matches
        const { error: e2, count } = await supa
          .from(table)
          .update(payload, { count: 'exact' })
          .match({ turn_id: turnId, [col]: match.path });
        if (!e2 && (count ?? 0) > 0) {
          await tryInsertFixNote({ turn_id: turnId, photo_path: match.path, note: match.note || '' });
          return true;
        }
      } else if (data) {
        await tryInsertFixNote({ turn_id: turnId, photo_id: data.id, photo_path: match.path, note: match.note || '' });
        return true;
      }
    }
  }

  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const turnId = (req.query.id || '').toString().trim();
    if (!turnId) return res.status(400).json({ error: 'missing id' });

    // ---------- Accept BOTH the new and legacy payloads ----------
    // New (from review.js):  { notes: [{ path|id, note }], summary, send_sms }
    // Legacy (your file):    { overall_note, photos: [...], notify }
    const body = req.body || {};
    const notes =
      Array.isArray(body.notes) ? body.notes :
      Array.isArray(body.photos) ? body.photos.map(p => ({ id: p.id, path: p.path, note: p.note })) :
      [];
    const summary =
      typeof body.summary === 'string' ? body.summary :
      typeof body.overall_note === 'string' ? body.overall_note :
      '';
    const notify =
      typeof body.send_sms === 'boolean' ? body.send_sms :
      typeof body.notify === 'boolean' ? body.notify :
      true;

    const ts = nowIso();

    // ---------- 1) Put the turn into needs_fix ----------
    {
      const { error } = await supa
        .from('turns')
        .update({
          status: 'needs_fix',
          needs_fix_at: ts,
          manager_note: summary || null,   // tolerate different columns:
          manager_notes: summary || null,  // Supabase ignores extra keys
        })
        .eq('id', turnId);
      if (error && !/column .* does not exist/i.test(error.message)) {
        throw error;
      }
    }

    // ---------- 2) Flag specific photos + store notes ----------
    let flagged = 0;
    const attempted = [];

    for (const n of notes) {
      const match = {
        id: n?.id || null,
        path: n?.path || null,
        note: typeof n?.note === 'string' ? n.note : ''
      };

      let ok = false;
      // Try newer table
      ok = ok || await flagPhotoOnTable('turn_photos', turnId, match, ts);
      // Fallback to legacy
      ok = ok || await flagPhotoOnTable('photos', turnId, match, ts);

      if (ok) flagged++;
      attempted.push({ ...match, ok });
    }

    // ---------- 3) Get cleaner phone + property name ----------
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
      const { data: c } = await supa
        .from('cleaners')
        .select('phone')
        .eq('id', t.cleaner_id)
        .maybeSingle();
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

    // ---------- 4) SMS deep link (optional) ----------
    if (notify && cleanerPhone) {
      const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.turnqa.com';
      // We use "needs-fix" to be explicit; your capture page normalizes this to the fix tab.
      const link = `${base}/capture?tab=needs-fix&turn=${encodeURIComponent(turnId)}`;

      // Include the first 1–2 notes inline for quick context (trimmed), if present.
      const visibleNotes = notes
        .map(n => (n?.note || '').trim())
        .filter(Boolean)
        .slice(0, 2);

      const msg =
        `TurnQA: Updates needed${propertyName ? ` at ${propertyName}` : ''}.\n` +
        (summary ? `Note: ${summary}\n` : '') +
        (visibleNotes.length ? visibleNotes.map((t,i)=>`• ${t}`).join('\n') + '\n' : '') +
        (flagged > 0 ? `${flagged} item(s) marked.\n` : '') +
        `Resume here: ${link}`;
      await sendSmsMinimal(cleanerPhone, msg);
    }

    return res.json({
      ok: true,
      flagged,
      summary_used: !!summary,
      attempted // [{ id?, path?, note?, ok }]
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[api/turns/[id]/needs-fix] error', e);
    return res.status(500).json({ error: e.message || 'needs-fix failed' });
  }
}
