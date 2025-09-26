// pages/api/submit-turn.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  // Server-side key so we can write regardless of RLS
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function nowIso() {
  return new Date().toISOString();
}

// Normalize body into { turnId, photos[] }
function parseBody(body) {
  const tId = (body.turnId || body.turn_id || '').trim();
  const photos = Array.isArray(body.photos) ? body.photos : [];
  return { turnId: tId, photos };
}

export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = await (async () => {
      try { return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
      catch { return {}; }
    })();

    const { turnId, photos } = parseBody(body);
    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    // Prepare rows from capture payload
    // capture.js pushes: { name, shotId, url: up.path, width, height, preview }
    const rows = (photos || [])
      .map(p => {
        const storagePath = (p.path || p.url || '').toString();
        if (!storagePath) return null;
        return {
          turn_id: turnId,
          path: storagePath,                          // canonical storage path
          shot_id: p.shotId || p.shot_id || null,     // optional
          area_key: p.area_key || '',                 // optional (may be empty if not sent from client)
          created_at: nowIso(),
        };
      })
      .filter(Boolean);

    // Persist photo rows
    if (rows.length) {
      // First try the new table
      const ins1 = await supa.from('turn_photos').insert(rows);
      if (ins1.error) {
        // If new table insert failed (e.g., columns missing), try legacy table with a pared-down shape
        const legacyRows = rows.map(r => ({
          turn_id: r.turn_id,
          path: r.path,
          area_key: r.area_key || '',
          created_at: r.created_at,
        }));
        const ins2 = await supa.from('photos').insert(legacyRows);
        if (ins2.error) {
          // Surface the most helpful message
          throw new Error(ins1.error.message || ins2.error.message || 'insert failed');
        }
      }
    }

    // Mark the turn as submitted
    {
      const { error } = await supa
        .from('turns')
        .update({ status: 'submitted', submitted_at: nowIso() })
        .eq('id', turnId);
      if (error) throw error;
    }

    // All good
    return res.json({ ok: true });
  } catch (e) {
    console.error('submit-turn error', e);
    return res.status(500).json({ error: e.message || 'submit-turn failed' });
  }
}
