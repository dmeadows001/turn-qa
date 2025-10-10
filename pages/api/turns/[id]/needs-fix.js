// pages/api/turns/[id]/needs-fix.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

let sendSmsMinimal = async () => {};
try {
  // Use your existing helper if available
  ({ sendSmsMinimal } = require('@/lib/sms'));
} catch (_) {
  // Lightweight fallback using Twilio env vars if present
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

function nowIso() { return new Date().toISOString(); }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const turnId = (req.query.id || '').toString().trim();
    if (!turnId) return res.status(400).json({ error: 'missing id' });

    // Body contract:
    // { overall_note?: string, photos?: [{ id?: string, path?: string, note?: string }], notify?: boolean }
    const { overall_note = '', photos = [], notify = true } = req.body || {};
    const ts = nowIso();

    // 1) Put the turn into needs_fix (preserve existing columns if any)
    {
      const { error } = await supa
        .from('turns')
        .update({
          status: 'needs_fix',
          needs_fix_at: ts,
          manager_note: overall_note || null, // okay if column doesn't exist (Supabase will ignore unknown keys)
        })
        .eq('id', turnId);
      if (error && !/column .* does not exist/i.test(error.message)) throw error;
    }

    // 2) Flag specific photos with notes (works for both schemas)
    let flagged = 0;

    async function flagOn(table, match) {
      const payload = { needs_fix: true, needs_fix_at: ts };
      if (typeof match.note === 'string' && match.note.trim()) {
        payload.manager_notes = match.note.trim();
      }

      if (match.id) {
        const { error } = await supa.from(table).update(payload).eq('id', match.id);
        return { ok: !error };
      }

      if (match.path) {
        // try common column spellings
        const candidates = ['path', 'storage_path', 'photo_path', 'url', 'file'];
        for (const col of candidates) {
          const { error, count } = await supa
            .from(table)
            .update(payload, { count: 'exact' })
            .match({ turn_id: turnId, [col]: match.path });
          if (!error && (count ?? 0) > 0) return { ok: true };
        }
      }
      return { ok: false };
    }

    for (const p of Array.isArray(photos) ? photos : []) {
      let ok = false;

      // try newer table first
      const r1 = await flagOn('turn_photos', p);
      ok = ok || r1.ok;

      // fallback to legacy
      if (!ok) {
        const r2 = await flagOn('photos', p);
        ok = ok || r2.ok;
      }
      if (ok) flagged++;
    }

    // 3) Find cleaner phone to notify
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

    // 4) SMS deep link (optional)
    if (notify && cleanerPhone) {
      const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.turnqa.com';
      const link = `${base}/capture?tab=needs-fix&turn=${encodeURIComponent(turnId)}`;
      const msg =
        `TurnQA: Updates needed${propertyName ? ` at ${propertyName}` : ''}.\n` +
        (overall_note ? `Note: ${overall_note}\n` : '') +
        (flagged > 0 ? `${flagged} item(s) marked.\n` : '') +
        `Resume here: ${link}`;
      await sendSmsMinimal(cleanerPhone, msg);
    }

    return res.json({ ok: true, flagged });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[api/turns/[id]/needs-fix] error', e);
    return res.status(500).json({ error: e.message || 'needs-fix failed' });
  }
}
