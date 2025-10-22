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
        _path_value: storagePath,        // normalized source path
        shot_id: p.shotId || p.shot_id || null,
        area_key: p.area_key || '',      // we’ll enrich from template_shots if empty
        created_at: nowIso(),
      };
    })
    .filter(Boolean) as any[];
}

// Enrich missing area_key from template_shots
async function hydrateAreaKeys(supa:any, rows:any[]){
  const need = rows.filter(r => !r.area_key && r.shot_id).map(r => String(r.shot_id));
  const unique = Array.from(new Set(need));
  if (!unique.length) return rows;

  const { data: ts, error } = await supa
    .from('template_shots')
    .select('id, area_key')
    .in('id', unique);

  if (error || !Array.isArray(ts)) return rows;

  const map = Object.fromEntries(ts.map(t => [String(t.id), t.area_key || '']));
  return rows.map(r => (!r.area_key && r.shot_id)
    ? { ...r, area_key: map[String(r.shot_id)] || '' }
    : r
  );
}

// Try inserting into turn_photos with multiple column shapes (loose typing to satisfy TS)
// First try with `is_fix: true`; if that fails due to column missing, retry without it.
async function tolerantInsertTurnPhotos(supa:any, rows:any[]){
  if (!rows.length) return { ok:true, tried:0 };

  const shapesWithFix: Array<(r:any)=>Record<string, any>> = [
    (r:any)=>({ turn_id:r.turn_id, storage_path:r._path_value, shot_id:r.shot_id, area_key:r.area_key, is_fix:true, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, path:         r._path_value, shot_id:r.shot_id, area_key:r.area_key, is_fix:true, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, photo_path:   r._path_value, shot_id:r.shot_id, area_key:r.area_key, is_fix:true, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, url:          r._path_value, shot_id:r.shot_id, area_key:r.area_key, is_fix:true, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, file:         r._path_value, shot_id:r.shot_id, area_key:r.area_key, is_fix:true, created_at:r.created_at }),
  ];
  const shapesNoFix: Array<(r:any)=>Record<string, any>> = [
    (r:any)=>({ turn_id:r.turn_id, storage_path:r._path_value, shot_id:r.shot_id, area_key:r.area_key, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, path:         r._path_value, shot_id:r.shot_id, area_key:r.area_key, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, photo_path:   r._path_value, shot_id:r.shot_id, area_key:r.area_key, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, url:          r._path_value, shot_id:r.shot_id, area_key:r.area_key, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, file:         r._path_value, shot_id:r.shot_id, area_key:r.area_key, created_at:r.created_at }),
  ];

  // pass 1: try with is_fix
  for (const make of shapesWithFix){
    const payload = rows.map((r:any) => make(r)) as any[];
    const { error } = await supa.from('turn_photos').insert(payload, { returning:'minimal' });
    if (!error) return { ok:true, tried: payload.length, usedFix:true };
    const msg = (error.message||'').toLowerCase();
    if (!/is_fix|column.*does not exist/.test(msg)) {
      // Not an is_fix-missing error; keep trying other shapes with is_fix
      continue;
    }
    // If the specific error is that is_fix doesn't exist, we’ll try the no-fix shapes
    break;
  }

  // pass 2: retry without is_fix
  let lastErr:any = null;
  for (const make of shapesNoFix){
    const payload = rows.map((r:any) => make(r)) as any[];
    const { error } = await supa.from('turn_photos').insert(payload, { returning:'minimal' });
    if (!error) return { ok:true, tried: payload.length, usedFix:false };
    lastErr = error;
    const msg = (error.message||'').toLowerCase();
    if (!/column|does not exist|null value|constraint|invalid input|duplicate/i.test(msg)){
      break;
    }
  }

  return { ok:false, tried:rows.length, error:lastErr };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = parseBody(req.body);
    const turnId = String(body.turnId || body.turn_id || '').trim();
    const photos = Array.isArray(body.photos) ? body.photos : [];
    const reply: string = String(body.reply || body.message || '').trim();
    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
    if (!url || !key) return res.status(500).json({ error:'Supabase service env vars missing' });

    const supa = createClient(url, key);

    // 1) Store the fix photos (with area_key enrichment)
    if (photos.length){
      let rows = buildRows(turnId, photos);
      rows = await hydrateAreaKeys(supa, rows);
      const ins = await tolerantInsertTurnPhotos(supa, rows);
      if (!ins.ok) return res.status(500).json({ error: ins.error?.message || 'could not save fix photos' });
    }

    // 2) Update the turn: status back to SUBMITTED + store cleaner note if provided
    const turnUpdate: Record<string, any> = { status: 'submitted', updated_at: nowIso() };
    if (reply) {
      // write to whichever column you keep for the cleaner’s message
      // (common names we’ve seen: cleaner_note / cleaner_reply / cleaner_message)
      turnUpdate.cleaner_note = reply;
    }
    try { await supa.from('turns').update(turnUpdate).eq('id', turnId); } catch {}

    // 3) Optional: mark last_fix_submitted_at if the column exists
    try { await supa.from('turns').update({ last_fix_submitted_at: nowIso() }).eq('id', turnId); } catch {}

    // 4) Notify the manager (kind = 'fix'); returns test info if DISABLE_SMS=1
    const notify = await notifyManagerForTurn(turnId, 'fix');

    return res.json({
      ok:true,
      notify,
      testMode: process.env.DISABLE_SMS === '1',
      status: 'submitted'
    });
  } catch (e:any) {
    console.error('[submit-fix] error', e);
    return res.status(500).json({ error: e.message || 'submit-fix failed' });
  }
}
