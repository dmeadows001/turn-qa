// pages/api/resubmit-turn.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;
const nowIso = () => new Date().toISOString();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { turn_id, reply = '', photos = [] } = req.body || {};
    if (!turn_id) return res.status(400).json({ error: 'missing turn_id' });

    const ts = nowIso();

    // --- A) Update status to submitted ---
    {
      const { error } = await supa
        .from('turns')
        .update({ status: 'submitted', submitted_at: ts })
        .eq('id', turn_id);
      if (error && !/column .* does not exist/i.test(error.message)) throw error;
    }

    // --- B) Save cleaner note in whichever column exists ---
    // we try `cleaner_note`, then `cleaner_reply`, then `cleaner_message`
    async function trySave(col) {
      const { error } = await supa
        .from('turns')
        .update({ [col]: reply || null })
        .eq('id', turn_id);
      if (error) {
        if (/column .* does not exist/i.test(error.message)) return false; // try next column
        throw error; // a real error
      }
      return true;
    }

    let noteSavedIn = null;
    if (reply && reply.trim().length > 0) {
      for (const c of ['cleaner_note', 'cleaner_reply', 'cleaner_message']) {
        const ok = await trySave(c).catch(e => { throw e; });
        if (ok) { noteSavedIn = c; break; }
      }
    }

    // --- C) (Optional) Record photos if you want.
    // We no-op here to avoid changing your current photo pipeline.
    // If you DO want to persist paths on this endpoint, uncomment below:
    //
    // try {
    //   const rows = (Array.isArray(photos) ? photos : [])
    //     .filter(p => p?.path)
    //     .map(p => ({ turn_id, path: p.path, created_at: ts }));
    //   if (rows.length) {
    //     // Try turn_photos first, then photos
    //     let { error } = await supa.from('turn_photos').insert(rows);
    //     if (error && /relation .* does not exist/i.test(error.message)) {
    //       const r2 = await supa.from('photos').insert(rows);
    //       if (r2.error) console.error('[resubmit-turn photos insert] error:', r2.error);
    //     } else if (error) {
    //       console.error('[resubmit-turn photos insert] error:', error);
    //     }
    //   }
    // } catch (e) {
    //   console.error('[resubmit-turn photos] exception', e);
    // }

    return res.json({
      ok: true,
      status: 'submitted',
      note_saved_in: noteSavedIn, // which column was used (if any)
    });
  } catch (e) {
    console.error('[api/resubmit-turn] error', e);
    return res.status(500).json({ error: e?.message || 'resubmit failed' });
  }
}
