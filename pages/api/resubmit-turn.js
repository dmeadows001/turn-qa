// pages/api/resubmit-turn.js
import { supabaseAdmin } from '../../lib/supabase';

// Optional: Twilio SMS notify (managers) if configured
function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  try {
    // eslint-disable-next-line global-require
    const twilio = require('twilio');
    return twilio(sid, tok);
  } catch {
    return null;
  }
}

function getSender() {
  // Prefer Messaging Service; fall back to a From number
  const svc = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_FROM;
  if (svc) return { messagingServiceSid: svc };
  if (from) return { from };
  return null;
}

function siteUrl(req) {
  // Try env first, then Vercel headers, then origin fallback
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (env) return env.replace(/\/+$/, '');
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  if (host) return `${proto}://${host}`;
  return 'https://www.turnqa.com';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { turn_id, reply, photos } = req.body || {};
    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });

    // 1) Load the turn (get property_id)
    const { data: turn, error: tErr } = await supabaseAdmin
      .from('turns')
      .select('id, property_id')
      .eq('id', turn_id)
      .single();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Insert any new photos into turn_photos
    let inserted = 0;
    if (Array.isArray(photos) && photos.length) {
      const rows = photos
        .filter(p => p && p.path)
        .map(p => ({
          turn_id: turn_id,
          storage_path: p.path,             // your /api/upload-url returns this as "path"
          area_key: p.area_key || null,     // optional label to group fixes by area
        }));

      if (rows.length) {
        const { error: ipErr, count } = await supabaseAdmin
          .from('turn_photos')
          .insert(rows, { count: 'exact' });
        if (ipErr) throw ipErr;
        inserted = count || rows.length;
      }
    }

    // 3) Update the turn status + cleaner reply
    const { error: uErr } = await supabaseAdmin
      .from('turns')
      .update({
        status: 'submitted',
        cleaner_reply: (reply && String(reply).trim()) || null,
        resubmitted_at: new Date().toISOString(),
      })
      .eq('id', turn_id);
    if (uErr) throw uErr;

    // 4) Notify managers by SMS (no nested FKs; do it in 2 calls)
    const client = getTwilio();
    const sender = getSender();
    let notified = 0;

    if (client && sender) {
      // 4a) Look up manager IDs linked to the property
      const { data: links, error: lErr } = await supabaseAdmin
        .from('property_managers')
        .select('manager_id')
        .eq('property_id', turn.property_id);
      if (lErr) throw lErr;

      const managerIds = (links || []).map(r => r.manager_id).filter(Boolean);
      if (managerIds.length) {
        // 4b) Load those managers’ phones (who consented)
        const { data: mgrs, error: mErr } = await supabaseAdmin
          .from('managers')
          .select('id, phone, sms_consent')
          .in('id', managerIds);
        if (mErr) throw mErr;

        const base = siteUrl(req);
        const url = `${base}/turns/${turn_id}/review?manager=1`;
        const shortId = String(turn_id).slice(0, 8);

        for (const m of mgrs || []) {
          if (!m?.phone || m.sms_consent === false) continue;
          try {
            await client.messages.create({
              to: m.phone,
              body:
                `Cleaner submitted fixes for Turn ${shortId}. Review: ${url}` +
                `\nReply STOP to unsubscribe or HELP for help.`,
              ...sender,
            });
            notified++;
          } catch {
            // Ignore individual per-number failures; continue to others
          }
        }
      }
    }

    return res.status(200).json({ ok: true, inserted, notified });
  } catch (e) {
    console.error('resubmit-turn error:', e);
    return res.status(500).json({ error: e.message || 'failed' });
  }
}
