// pages/api/resubmit-turn.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;
const nowIso = () => new Date().toISOString();

// Try a list of column names until one exists.
async function updateCleanerNoteWithFallback(turnId, reply) {
  const tried = [];
  const payloadBase = {
    status: 'submitted',
    submitted_at: nowIso(),
  };

  // Try these in order; adjust if your schema uses something else.
  const candidates = ['cleaner_note', 'cleaner_reply', 'cleaner_message'];

  for (const col of candidates) {
    try {
      const payload = { ...payloadBase };
      if (reply && String(reply).trim()) payload[col] = String(reply).trim();

      const { error } = await supa.from('turns').update(payload).eq('id', turnId);
      if (!error) return { ok: true, used: col, tried };
      // If it's a “column does not exist” error, keep going; otherwise, bubble up.
      if (!/column .* does not exist/i.test(error.message || '')) {
        return { ok: false, tried: [...tried, col], error: error.message || String(error) };
      }
      tried.push(col);
    } catch (e) {
      const msg = e?.message || String(e);
      if (!/column .* does not exist/i.test(msg)) {
        return { ok: false, tried: [...tried, col], error: msg };
      }
      tried.push(col);
      // continue loop
    }
  }

  // If we’re here, none of the columns exist; still try to set status/submitted_at only.
  const { error: finalErr } = await supa
    .from('turns')
    .update(payloadBase)
    .eq('id', turnId);

  return finalErr
    ? { ok: false, tried, error: finalErr.message || String(finalErr) }
    : { ok: true, used: null, tried };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { turn_id, reply = '', photos = [] } = req.body || {};
    const turnId = String(turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn_id' });

    // (Optional) You can record uploaded photo paths somewhere if your app needs it.
    // Most setups using /api/upload-url + a storage list endpoint do NOT require DB inserts here,
    // so we leave photos alone to avoid breaking existing flows.

    // Update status and store cleaner message with column fallback
    const result = await updateCleanerNoteWithFallback(turnId, reply);

    if (!result.ok) {
      // Non-fatal, but let the client know what happened
      return res.status(200).json({
        ok: true,
        warning: 'Cleaner note column not found; status updated',
        fallback_error: result.error,
        columns_tried: result.tried,
        used_column: null,
      });
    }

    return res.json({
      ok: true,
      used_column: result.used,     // which column we ended up using (if any)
      columns_tried: result.tried,  // which ones we skipped because they didn’t exist
      photos_received: Array.isArray(photos) ? photos.length : 0,
    });
  } catch (e) {
    console.error('[api/resubmit-turn] error', e);
    return res.status(500).json({ error: e?.message || 'resubmit failed' });
  }
}
