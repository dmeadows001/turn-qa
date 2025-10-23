// pages/api/turns/submit-fix.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { notifyManagerForTurn } from '@/lib/notify';

export const config = { api: { bodyParser: true } };

function nowIso(){ return new Date().toISOString(); }

function parseBody(raw:any){
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); }
  catch { return {}; }
}

function buildRows(turnId:string, photos:any[]){
  return (photos || [])
    .map((p:any) => {
      const storagePath = (p.path || p.url || '').toString().trim();
      if (!storagePath) return null;
      return {
        turn_id: turnId,
        _path_value: storagePath,
        shot_id: p.shotId || p.shot_id || null,
        area_key: p.area_key || '',
        // try to persist fix metadata if your schema supports it
        is_fix: true,
        cleaner_note: p.note || p.cleaner_note || null,
        created_at: nowIso(),
      };
    })
    .filter(Boolean) as any[];
}

// Try inserting into turn_photos with multiple column shapes (loose typing to satisfy TS)
async function tolerantInsertTurnPhotos(supa:any, rows:any[]){
  if (!rows.length) return { ok:true, tried:0 };

  const shapes: Array<(r:any)=>Record<string, any>> = [
    // prefer full shape if columns exist
    (r:any)=>({ turn_id:r.turn_id, storage_path:r._path_value, shot_id:r.shot_id, area_key:r.area_key, is_fix:r.is_fix, cleaner_note:r.cleaner_note, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, path:         r._path_value, shot_id:r.shot_id, area_key:r.area_key, is_fix:r.is_fix, cleaner_note:r.cleaner_note, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, photo_path:   r._path_value, shot_id:r.shot_id, area_key:r.area_key, is_fix:r.is_fix, cleaner_note:r.cleaner_note, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, url:          r._path_value, shot_id:r.shot_id, area_key:r.area_key, is_fix:r.is_fix, cleaner_note:r.cleaner_note, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, file:         r._path_value, shot_id:r.shot_id, area_key:r.area_key, is_fix:r.is_fix, cleaner_note:r.cleaner_note, created_at:r.created_at }),
    // minimal fallbacks (older schemas)
    (r:any)=>({ turn_id:r.turn_id, storage_path: r._path_value }),
    (r:any)=>({ turn_id:r.turn_id, path:         r._path_value }),
  ];

  let lastErr:any = null;
  let tried = 0;

  for (const make of shapes){
    tried++;
    const payload = rows.map((r:any) => make(r)) as any[];
    const { error } = await supa.from('turn_photos').insert(payload, { returning:'minimal' });
    if (!error) return { ok:true, tried };
    const msg = (error.message||'').toLowerCase();
    if (!/column|does not exist|null value|constraint|invalid input|duplicate/i.test(msg)){
      lastErr = error; break;
    }
    lastErr = error;
  }

  return { ok:false, tried, error:lastErr };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = parseBody(req.body);
    const turnId = String(body.turnId || body.turn_id || '').trim();
    const photos = Array.isArray(body.photos) ? body.photos : [];
    // optional overall cleaner reply (we keep same shape, even if unused)
    const _reply: string = String(body.reply || body.cleaner_reply || '').trim();

    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
    if (!url || !key) return res.status(500).json({ error:'Supabase service env vars missing' });

    const supa = createClient(url, key);

    // 1) Store the fix photos (don’t change approval state here)
    if (photos.length){
      const rows = buildRows(turnId, photos);
      const ins = await tolerantInsertTurnPhotos(supa, rows);
      if (!ins.ok) return res.status(500).json({ error: ins.error?.message || 'could not save fix photos' });
    }

    // 2) Mark last_fix_submitted_at and set status -> 'submitted' (with tolerant fallbacks)
    const when = nowIso();
    let newStatus = 'submitted';
    try {
      const { error: e1 } = await supa
        .from('turns')
        .update({ status: newStatus, last_fix_submitted_at: when })
        .eq('id', turnId);
      if (e1) throw e1;
    } catch (e:any) {
      // fallback: some installs may not have both columns; try independent updates
      try {
        await supa.from('turns').update({ last_fix_submitted_at: when }).eq('id', turnId);
      } catch {}
      try {
        await supa.from('turns').update({ status: newStatus }).eq('id', turnId);
      } catch (e2:any) {
        console.warn('[submit-fix] could not set status=submitted:', e2?.message || e2);
        // don’t hard-fail the request; keep newStatus best-effort
      }
    }

    // 3) Notify the manager (kind = 'fix'); DO NOT fail the request if SMS/email errors out
    let notify: any = null;
    try {
      notify = await notifyManagerForTurn(turnId, 'fix');
    } catch (e:any) {
      console.warn('[submit-fix] notify failed (non-fatal):', e?.message || e);
    }

    return res.json({ ok:true, notify, testMode: process.env.DISABLE_SMS === '1', newStatus });
  } catch (e:any) {
    console.error('[submit-fix] error', e);
    return res.status(500).json({ error: e.message || 'submit-fix failed' });
  }
}
