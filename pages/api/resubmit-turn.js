// pages/api/resubmit-turn.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { notifyManagerForTurn } from '@/lib/notify';

// Support both export styles (function returning client vs direct client)
const supa = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { turn_id, reply = '', photos = [] } = (req.body || {});
    const tid = (turn_id || '').trim();
    if (!tid) return res.status(400).json({ error: 'turn_id is required' });

    // 1) Load turn (to validate it exists + get property_id)
    const { data: turn, error: tErr } = await supa
      .from('turns')
      .select('id, property_id')
      .eq('id', tid)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Insert fix photos (if any)
    const cleanPhotos = Array.isArray(photos) ? photos.filter(p => p && (p.path || p.storage_path || p.url)) : [];
    if (cleanPhotos.length > 0) {
      const rows = cleanPhotos.map(p => ({
        turn_id: tid,
        storage_path: p.path || p.storage_path || p.url, // tolerant field names
        area_key: 'fix',
        created_at: new Date().toISOString(),
      }));
      const { error: insErr } = await supa.from('turn_photos').insert(rows, { returning: 'minimal' });
      if (insErr) throw insErr;
    }

    // 3) Update status + cleaner reply + resubmitted_at
    const { error: upErr } = await supa
      .from('turns')
      .update({
        status: 'submitted',
        cleaner_reply: reply || null,
        resubmitted_at: new Date().toISOString(),
      })
      .eq('id', tid);
    if (upErr) throw upErr;

    // 4) 🔔 Notify manager (don’t block response)
    notifyManagerForTurn(tid, 'fix').catch(console.error);

    return res.json({ ok: true });
  } catch (e) {
    console.error('resubmit-turn error:', e);
    return res.status(500).json({ error: e.message || 'failed' });
  }
}
