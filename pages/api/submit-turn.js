import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { turnId, photos = [] } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!turnId || photos.length === 0) return res.status(400).json({ error: 'Missing data' });

    // store photo metadata
    const insertRows = photos.map(p => ({
      turn_id: turnId,
      area_key: p.areaKey,
      url: p.url,
      width: p.width || null,
      height: p.height || null
    }));

    const { error: pErr } = await supabaseAdmin.from('photos').insert(insertRows);
    if (pErr) throw pErr;

    // flag the turn as submitted
    await supabaseAdmin.from('turns').update({ status: 'submitted' }).eq('id', turnId);

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('submit-turn error:', e);
    res.status(500).json({ error: 'submit-turn failed' });
  }
}

