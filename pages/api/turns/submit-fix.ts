import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { notifyManagerForTurn } from '@/lib/notify';

// tolerant insert helpers copied from your submit-turn.js:
function nowIso(){ return new Date().toISOString(); }

function parseBody(raw:any){ try{ return typeof raw==='string'? JSON.parse(raw): raw; }catch{ return {}; } }
function buildRows(turnId:string, photos:any[]){ return (photos||[]).map((p:any)=>{
  const path = (p.path || p.url || '').toString().trim(); if(!path) return null;
  return { turn_id: turnId, _path_value: path, shot_id: p.shotId || p.shot_id || null, area_key: p.area_key || '', created_at: nowIso() };
}).filter(Boolean); }

async function tolerantInsertTurnPhotos(supa:any, rows:any[]){
  if (!rows.length) return { ok:true, tried:0 };
  const shapes = [
    (r:any)=>({ turn_id:r.turn_id, storage_path:r._path_value, shot_id:r.shot_id, area_key:r.area_key, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, path:         r._path_value, shot_id:r.shot_id, area_key:r.area_key, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, photo_path:   r._path_value, shot_id:r.shot_id, area_key:r.area_key, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, url:          r._path_value, shot_id:r.shot_id, area_key:r.area_key, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, file:         r._path_value, shot_id:r.shot_id, area_key:r.area_key, created_at:r.created_at }),
    (r:any)=>({ turn_id:r.turn_id, storage_path:r._path_value }),
    (r:any)=>({ turn_id:r.turn_id, path:        r._path_value }),
  ];
  let lastErr=null, tried=0;
  for (const make of shapes){
    tried++; const payload = rows.map(make);
    const { error } = await supa.from('turn_photos').insert(payload, { returning:'minimal' });
    if (!error) return { ok:true, tried };
    const msg = (error.message||'').toLowerCase();
    if (!/column|does not exist|null value|constraint|invalid input|duplicate/i.test(msg)){ lastErr = error; break; }
    lastErr = error;
  }
  return { ok:false, tried, error:lastErr };
}

export const config = { api: { bodyParser: true } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = parseBody(req.body);
    const turnId = String(body.turnId || body.turn_id || '').trim();
    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
    if (!url || !key) return res.status(500).json({ error:'Supabase service env vars missing' });
    const supa = createClient(url, key);

    // 1) store the fix photos (don’t change final state yet)
    if (photos.length){
      const rows = buildRows(turnId, photos);
      const ins = await tolerantInsertTurnPhotos(supa, rows);
      if (!ins.ok) return res.status(500).json({ error: ins.error?.message || 'could not save fix photos' });
    }

    // 2) bump a “last_fix_submitted_at” marker (optional, harmless if column absent)
    await supa.from('turns').update({ last_fix_submitted_at: nowIso() }).eq('id', turnId);

    // 3) notify the manager (kind = 'fix')
    const notify = await notifyManagerForTurn(turnId, 'fix');

    return res.json({ ok:true, notify, testMode: process.env.DISABLE_SMS === '1' });
  } catch (e: any) {
    console.error('[submit-fix] error', e);
    return res.status(500).json({ error: e.message || 'submit-fix failed' });
  }
}
