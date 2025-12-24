// pages/api/turns/submit-fix.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { notifyManagerForTurn } from '@/lib/notify';

export const config = { api: { bodyParser: true } };

function nowIso() {
  return new Date().toISOString();
}

function parseBody(raw: any) {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
  } catch {
    return {};
  }
}

/**
 * Build canonical rows with:
 * - _path_value as the chosen photo path/url (normalized)
 * - cleaner_note as manager-facing note (prefer EN translated)
 * - bilingual note fields for history
 */
function buildRows(turnId: string, photos: any[]) {
  return (photos || [])
    .map((p: any) => {
      const storagePath = (p.path || p.url || '').toString().trim();
      if (!storagePath) return null;

      // Per-photo bilingual fields (optional)
      const noteOriginal = String(p.note_original || p.cleaner_note_original || '').trim();
      const noteTranslated = String(p.note_translated || p.cleaner_note_translated || '').trim();
      const noteOriginalLang = String(p.note_original_lang || p.cleaner_note_original_lang || '').trim();
      const noteTranslatedLang = String(p.note_translated_lang || p.cleaner_note_translated_lang || '').trim();

      // Legacy single note (optional)
      const legacyNote = String(p.note || p.cleaner_note || '').trim();

      // Manager-facing note: prefer EN translated when present, else legacy, else original
      const noteSent = noteTranslated || legacyNote || noteOriginal || null;

      return {
        turn_id: turnId,
        _path_value: storagePath,
        shot_id: p.shotId || p.shot_id || null,
        area_key: p.area_key || '',

        // mark these as FIX photos
        is_fix: true,

        // manager-facing note (string) + bilingual fields
        cleaner_note: noteSent,

        cleaner_note_original: noteOriginal || null,
        cleaner_note_translated: noteTranslated || null,

        cleaner_note_original_lang: noteOriginalLang || (noteOriginal ? 'es' : null),
        cleaner_note_translated_lang: noteTranslatedLang || (noteTranslated ? 'en' : null),

        created_at: nowIso(),
      };
    })
    .filter(Boolean) as any[];
}

// Try inserting into turn_photos with multiple column shapes
async function tolerantInsertTurnPhotos(supa: any, rows: any[]) {
  if (!rows.length) return { ok: true, tried: 0 };

  const shapes: Array<(r: any) => Record<string, any>> = [
    // Most complete (new schema)
    (r: any) => ({
      turn_id: r.turn_id,
      storage_path: r._path_value,
      shot_id: r.shot_id,
      area_key: r.area_key,
      is_fix: r.is_fix,
      cleaner_note: r.cleaner_note,
      cleaner_note_original: r.cleaner_note_original,
      cleaner_note_translated: r.cleaner_note_translated,
      cleaner_note_original_lang: r.cleaner_note_original_lang,
      cleaner_note_translated_lang: r.cleaner_note_translated_lang,
      created_at: r.created_at,
    }),
    (r: any) => ({
      turn_id: r.turn_id,
      path: r._path_value,
      shot_id: r.shot_id,
      area_key: r.area_key,
      is_fix: r.is_fix,
      cleaner_note: r.cleaner_note,
      cleaner_note_original: r.cleaner_note_original,
      cleaner_note_translated: r.cleaner_note_translated,
      cleaner_note_original_lang: r.cleaner_note_original_lang,
      cleaner_note_translated_lang: r.cleaner_note_translated_lang,
      created_at: r.created_at,
    }),
    (r: any) => ({
      turn_id: r.turn_id,
      photo_path: r._path_value,
      shot_id: r.shot_id,
      area_key: r.area_key,
      is_fix: r.is_fix,
      cleaner_note: r.cleaner_note,
      cleaner_note_original: r.cleaner_note_original,
      cleaner_note_translated: r.cleaner_note_translated,
      cleaner_note_original_lang: r.cleaner_note_original_lang,
      cleaner_note_translated_lang: r.cleaner_note_translated_lang,
      created_at: r.created_at,
    }),
    (r: any) => ({
      turn_id: r.turn_id,
      url: r._path_value,
      shot_id: r.shot_id,
      area_key: r.area_key,
      is_fix: r.is_fix,
      cleaner_note: r.cleaner_note,
      cleaner_note_original: r.cleaner_note_original,
      cleaner_note_translated: r.cleaner_note_translated,
      cleaner_note_original_lang: r.cleaner_note_original_lang,
      cleaner_note_translated_lang: r.cleaner_note_translated_lang,
      created_at: r.created_at,
    }),
    (r: any) => ({
      turn_id: r.turn_id,
      file: r._path_value,
      shot_id: r.shot_id,
      area_key: r.area_key,
      is_fix: r.is_fix,
      cleaner_note: r.cleaner_note,
      cleaner_note_original: r.cleaner_note_original,
      cleaner_note_translated: r.cleaner_note_translated,
      cleaner_note_original_lang: r.cleaner_note_original_lang,
      cleaner_note_translated_lang: r.cleaner_note_translated_lang,
      created_at: r.created_at,
    }),

    // Older schema (no bilingual cols) but still include cleaner_note
    (r: any) => ({
      turn_id: r.turn_id,
      storage_path: r._path_value,
      shot_id: r.shot_id,
      area_key: r.area_key,
      is_fix: r.is_fix,
      cleaner_note: r.cleaner_note,
      created_at: r.created_at,
    }),
    (r: any) => ({
      turn_id: r.turn_id,
      path: r._path_value,
      shot_id: r.shot_id,
      area_key: r.area_key,
      is_fix: r.is_fix,
      cleaner_note: r.cleaner_note,
      created_at: r.created_at,
    }),
    (r: any) => ({
      turn_id: r.turn_id,
      photo_path: r._path_value,
      shot_id: r.shot_id,
      area_key: r.area_key,
      is_fix: r.is_fix,
      cleaner_note: r.cleaner_note,
      created_at: r.created_at,
    }),
    (r: any) => ({
      turn_id: r.turn_id,
      url: r._path_value,
      shot_id: r.shot_id,
      area_key: r.area_key,
      is_fix: r.is_fix,
      cleaner_note: r.cleaner_note,
      created_at: r.created_at,
    }),
    (r: any) => ({
      turn_id: r.turn_id,
      file: r._path_value,
      shot_id: r.shot_id,
      area_key: r.area_key,
      is_fix: r.is_fix,
      cleaner_note: r.cleaner_note,
      created_at: r.created_at,
    }),

    // minimal fallbacks (very old schemas)
    (r: any) => ({ turn_id: r.turn_id, storage_path: r._path_value }),
    (r: any) => ({ turn_id: r.turn_id, path: r._path_value }),
  ];

  let lastErr: any = null;
  let tried = 0;

  for (const make of shapes) {
    tried++;
    const payload = rows.map((r: any) => make(r)) as any[];
    const { error } = await supa.from('turn_photos').insert(payload, { returning: 'minimal' });

    if (!error) return { ok: true, tried };

    const msg = (error.message || '').toLowerCase();
    // If it looks like a column mismatch / constraint / duplicate, try next shape.
    if (!/column|does not exist|null value|constraint|invalid input|duplicate/i.test(msg)) {
      lastErr = error;
      break;
    }
    lastErr = error;
  }

  return { ok: false, tried, error: lastErr };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = parseBody(req.body);

    const turnId = String(body.turnId || body.turn_id || '').trim();
    const photos = Array.isArray(body.photos) ? body.photos : [];

    // Legacy reply (what manager receives). We will prefer translated reply if provided.
    const legacyReply: string = String(body.reply || body.cleaner_reply || '').trim();

    // Bilingual reply fields (new)
    const replyOriginal: string = String(body.reply_original || '').trim();
    const replyTranslated: string = String(body.reply_translated || '').trim();
    const replyOriginalLang: string = String(body.reply_original_lang || '').trim();
    const replyTranslatedLang: string = String(body.reply_translated_lang || '').trim();

    // What we store in cleaner_reply/cleaner_note (manager-facing) — prefer English translated when present
    const replySent = replyTranslated || legacyReply || replyOriginal;

    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
    if (!url || !key) return res.status(500).json({ error: 'Supabase service env vars missing' });

    const supa = createClient(url, key);

    // 1) Store the fix photos (+ per-photo bilingual notes if provided)
    if (photos.length) {
      const rows = buildRows(turnId, photos);
      const ins = await tolerantInsertTurnPhotos(supa, rows);
      if (!ins.ok) {
        return res.status(500).json({ error: ins.error?.message || 'could not save fix photos' });
      }
    }

    // 2) Update the turn with cleaner reply + status + bilingual fields
    try {
      const updates: any = {
        status: 'submitted',
        submitted_at: nowIso(),
      };

      // Legacy fields for compatibility (what manager sees)
      if (replySent) {
        updates.cleaner_reply = replySent;
        updates.cleaner_note = replySent;
      }

      // Bilingual fields (only if present; columns exist in your DB per your screenshot)
      const ro = replyOriginal || replySent; // original (Spanish) - fallback if UI only sent reply
      const rt = replyTranslated || null;    // translated (English)

      if (ro) updates.cleaner_reply_original = ro;
      updates.cleaner_reply_translated = rt;

      const rol = replyOriginalLang || (ro ? 'es' : null);
      const rtl = replyTranslatedLang || (rt ? 'en' : null);

      updates.cleaner_reply_original_lang = rol;
      updates.cleaner_reply_translated_lang = rtl;

      let { error: updErr } = await supa.from('turns').update(updates).eq('id', turnId);

      // Extra safety: if any environment lacks bilingual columns, retry without them (do not break flow)
      if (updErr && /column .* does not exist/i.test(updErr.message || '')) {
        const fallback: any = {
          status: updates.status,
          submitted_at: updates.submitted_at,
        };
        if (replySent) {
          fallback.cleaner_reply = replySent;
          fallback.cleaner_note = replySent;
        }
        const retry = await supa.from('turns').update(fallback).eq('id', turnId);
        updErr = retry.error || null;
      }

      if (updErr) {
        console.warn('[submit-fix] could not update turns row:', updErr.message || updErr);
      }
    } catch (e: any) {
      console.warn('[submit-fix] turn update failed (non-fatal):', e?.message || e);
    }

    // 3) Notify manager (kind = 'fix'); non-fatal on error
    let notify: any = null;
    try {
      notify = await notifyManagerForTurn(turnId, 'fix');
    } catch (e: any) {
      console.warn('[submit-fix] notify failed (non-fatal):', e?.message || e);
    }

    return res.json({
      ok: true,
      notify,
      newStatus: 'submitted',
      replySaved: !!replySent,
      bilingualSaved: !!(replyOriginal || replyTranslated),
      replySentPreview: replySent ? replySent.slice(0, 80) : '',
      testMode: process.env.DISABLE_SMS === '1',
    });
  } catch (e: any) {
    console.error('[submit-fix] error', e);
    return res.status(500).json({ error: e.message || 'submit-fix failed' });
  }
}
