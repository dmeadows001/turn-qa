// pages/api/turns/submit-fix.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { notifyManagerForTurn } from '@/lib/notify';
import { readCleanerSession } from '@/lib/session';

export const config = { api: { bodyParser: true } };

const nowIso = () => new Date().toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBody(raw: any): any {
  if (typeof raw !== 'string') return raw || {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function stringValue(v: any): string {
  return typeof v === 'string' ? v.trim() : '';
}

type FixPhoto = {
  path: string;
  shotId: string | null;
  areaKey: string;
  cleanerNote: string | null;
  original: string | null;
  translated: string | null;
  originalLang: string | null;
  translatedLang: string | null;
};

function normalizePhotos(turnId: string, photos: any[]): FixPhoto[] {
  const result = new Map<string, FixPhoto>();
  for (const p of photos) {
    if (!p || typeof p !== 'object') throw new Error('Invalid photo entry');
    const path = stringValue(p.path || p.url);
    if (!path || !path.startsWith(`turns/${turnId}/`) || path.includes('..') || path.includes('?') || path.includes('#')) {
      throw new Error('Invalid fix photo storage path');
    }
    const rawShotId = stringValue(p.shotId || p.shot_id);
    const shotId = UUID.test(rawShotId) ? rawShotId : null;
    const original = stringValue(p.note_original || p.cleaner_note_original);
    const translated = stringValue(p.note_translated || p.cleaner_note_translated);
    const originalLang = stringValue(p.note_original_lang || p.cleaner_note_original_lang);
    const translatedLang = stringValue(p.note_translated_lang || p.cleaner_note_translated_lang);
    const legacyNote = stringValue(p.note || p.cleaner_note);
    result.set(path, {
      path, shotId,
      areaKey: stringValue(p.area_key),
      cleanerNote: translated || legacyNote || original || null,
      original: original || null,
      translated: translated || null,
      originalLang: originalLang || (original ? 'es' : null),
      translatedLang: translatedLang || (translated ? 'en' : null),
    });
  }
  return [...result.values()];
}

function isMissingColumn(error: any): boolean {
  const msg = String(error?.message || '');
  return /column|schema cache|does not exist/i.test(msg) || error?.code === 'PGRST204' || error?.code === '42703';
}

function photoFields(p: FixPhoto) {
  return {
    is_fix: true,
    cleaner_note: p.cleanerNote,
    cleaner_note_original: p.original,
    cleaner_note_translated: p.translated,
    cleaner_note_original_lang: p.originalLang,
    cleaner_note_translated_lang: p.translatedLang,
  };
}

// Existing photos were registered immediately after upload. Update those rows
// rather than inserting them again; insert only a genuinely missing row.
async function saveFixPhoto(supa: any, turnId: string, p: FixPhoto) {
  const { data: existing, error: lookupErr } = await supa
    .from('turn_photos')
    .select('id')
    .eq('turn_id', turnId)
    .eq('storage_path', p.path)
    .limit(1);
  if (lookupErr) throw lookupErr;

  const base = photoFields(p);
  const updateShapes: any[] = [
    base,
    { is_fix: true, cleaner_note: p.cleanerNote },
    { is_fix: true },
  ];
  const insertShapes: any[] = [
    { turn_id: turnId, storage_path: p.path, shot_id: p.shotId, area_key: p.areaKey, ...base, created_at: nowIso() },
    { turn_id: turnId, storage_path: p.path, shot_id: p.shotId, area_key: p.areaKey, is_fix: true, cleaner_note: p.cleanerNote, created_at: nowIso() },
    { turn_id: turnId, storage_path: p.path, shot_id: p.shotId, is_fix: true, cleaner_note: p.cleanerNote },
    { turn_id: turnId, storage_path: p.path, is_fix: true },
  ];

  let lastError: any = null;
  if (existing?.length) {
    for (const fields of updateShapes) {
      const { error } = await supa.from('turn_photos').update(fields)
        .eq('turn_id', turnId).eq('storage_path', p.path);
      if (!error) return;
      lastError = error;
      if (!isMissingColumn(error)) break;
    }
  } else {
    for (const fields of insertShapes) {
      const { error } = await supa.from('turn_photos').insert(fields);
      if (!error) return;
      lastError = error;
      // Do not retry a duplicate insert with different shapes.
      if (!isMissingColumn(error)) break;
    }
  }
  throw lastError || new Error('Could not save fix photo');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = parseBody(req.body);
    const turnId = stringValue(body.turnId || body.turn_id);
    if (!UUID.test(turnId)) return res.status(400).json({ error: 'Valid turnId is required' });
    if (body.photos != null && !Array.isArray(body.photos)) {
      return res.status(400).json({ error: 'photos must be an array' });
    }

    const session = readCleanerSession(req);
    if (!session?.cleaner_id) return res.status(401).json({ error: 'Cleaner authentication required' });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(500).json({ error: 'Supabase service env vars missing' });
    const supa = createClient(url, key);

    const { data: turn, error: turnErr } = await supa.from('turns')
      .select('id, cleaner_id, status').eq('id', turnId).single();
    if (turnErr || !turn) return res.status(404).json({ error: 'Turn not found' });
    if (turn.cleaner_id !== session.cleaner_id) {
      return res.status(403).json({ error: 'You are not authorized to submit fixes for this turnover' });
    }
    if (turn.status !== 'needs_fix') {
      return res.status(409).json({ error: 'This turnover is not awaiting fixes', currentStatus: turn.status });
    }

    let photos: FixPhoto[];
    try { photos = normalizePhotos(turnId, body.photos || []); }
    catch (e: any) { return res.status(400).json({ error: e.message }); }

    const legacyReply = stringValue(body.reply || body.cleaner_reply);
    const original = stringValue(body.reply_original);
    const translated = stringValue(body.reply_translated);
    const originalLang = stringValue(body.reply_original_lang);
    const translatedLang = stringValue(body.reply_translated_lang);
    const replySent = translated || legacyReply || original;

    // Preserve notes for already-registered photos and add any missing records.
    for (const photo of photos) await saveFixPhoto(supa, turnId, photo);

    const updates: any = { status: 'submitted', submitted_at: nowIso() };
    if (replySent) {
      updates.cleaner_reply = replySent;
      updates.cleaner_note = replySent;
    }
    const originalForHistory = original || replySent;
    if (originalForHistory) updates.cleaner_reply_original = originalForHistory;
    updates.cleaner_reply_translated = translated || null;
    updates.cleaner_reply_original_lang = originalLang || (originalForHistory ? 'es' : null);
    updates.cleaner_reply_translated_lang = translatedLang || (translated ? 'en' : null);

    // Only transition a turn that is still in needs_fix. Never claim success
    // if the database update failed or another request changed its status.
    let updated: any[] | null = null;
    let lastError: any = null;
    const fallback = { status: 'submitted', submitted_at: updates.submitted_at,
      ...(replySent ? { cleaner_reply: replySent, cleaner_note: replySent } : {}) };
    for (const payload of [updates, fallback, { status: 'submitted', submitted_at: updates.submitted_at }]) {
      const { data, error } = await supa.from('turns').update(payload)
        .eq('id', turnId).eq('status', 'needs_fix').select('id');
      if (!error) { updated = data || []; break; }
      lastError = error;
      if (!isMissingColumn(error)) break;
    }
    if (updated === null) throw lastError || new Error('Could not update turn status');
    if (!updated.length) return res.status(409).json({ error: 'Turn status changed; refresh and try again' });

    let notify: any = null;
    try { notify = await notifyManagerForTurn(turnId, 'fix'); }
    catch (e: any) { console.warn('[submit-fix] manager notification failed:', e?.message || e); }

    return res.json({
      ok: true, notify, newStatus: 'submitted',
      replySaved: !!replySent,
      bilingualSaved: !!(original || translated),
      replySentPreview: replySent.slice(0, 80),
      testMode: process.env.DISABLE_SMS === '1',
    });
  } catch (e: any) {
    console.error('[submit-fix] error', e);
    return res.status(500).json({ error: e?.message || 'submit-fix failed' });
  }
}
