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

function buildRows(turnId: string, photos: any[]) {
  return (photos || [])
    .map((p: any) => {
      const storagePath = (p.path || p.url || '').toString().trim();
      if (!storagePath) return null;
      return {
        turn_id: turnId,
        _path_value: storagePath,
        shot_id: p.shotId || p.shot_id || null,
        area_key: p.area_key || '',
        // mark these as FIX photos + per-photo cleaner note
        is_fix: true,
        cleaner_note: p.note || p.cleaner_note || null,
        created_at: nowIso(),
      };
    })
    .filter(Boolean) as any[];
}

// Try inserting into turn_photos with multiple column shapes
async function tolerantInsertTurnPhotos(supa: any, rows: any[]) {
  if (!rows.length) return { ok: true, tried: 0 };

  const shapes: Array<(r: any) => Record<string, any>> = [
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
    // minimal fallbacks (older schemas)
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
    // overall cleaner message from the bottom text area
    const reply: string = String(body.reply || body.cleaner_reply || '').trim();

    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
    if (!url || !key) return res.status(500).json({ error: 'Supabase service env vars missing' });

    const supa = createClient(url, key);

    // 1) Store the fix photos
    if (photos.length) {
      const rows = buildRows(turnId, photos);
      const ins = await tolerantInsertTurnPhotos(supa, rows);
      if (!ins.ok) {
        return res.status(500).json({ error: ins.error?.message || 'could not save fix photos' });
      }
    }

    // 2) Update the turn with cleaner reply + status
    try {
      const updates: any = { status: 'submitted' };
      if (reply) {
        // write to BOTH columns for compatibility
        updates.cleaner_reply = reply;
        updates.cleaner_note = reply;
      }

      const { error: updErr } = await supa
        .from('turns')
        .update(updates)
        .eq('id', turnId);

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
      replySaved: !!reply,
      testMode: process.env.DISABLE_SMS === '1',
    });
  } catch (e: any) {
    console.error('[submit-fix] error', e);
    return res.status(500).json({ error: e.message || 'submit-fix failed' });
  }
}
