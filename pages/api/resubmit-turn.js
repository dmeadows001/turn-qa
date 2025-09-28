// pages/api/resubmit-turn.js
import { supabaseAdmin } from '../../lib/supabase';
import Twilio from 'twilio';

function getTwilioSender() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const fromNum = process.env.TWILIO_FROM_NUMBER || '';
  const msgSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
  if (!sid || !token) return null;
  const client = Twilio(sid, token);
  return { client, fromNum, msgSid };
}

function absUrl(req, path) {
  const base = process.env.SITE_URL || `https://${req.headers.host}`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { turn_id, reply = '', photos = [] } = req.body || {};
    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });

    // 1) Load turn + property + (a) manager phone (via join) or (b) properties.manager_phone fallback
    const { data: turn, error: tErr } = await supabaseAdmin
      .from('turns')
      .select(`
        id, status, property_id, cleaner_name,
        properties:properties ( id, name, manager_phone ),
        manager_link:property_managers!property_managers_property_id_fkey (
          managers:managers ( phone )
        )
      `)
      .eq('id', turn_id)
      .single();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) If new photos are provided, avoid duplicates (by storage_path) and insert only new ones
    const newPaths = (photos || [])
      .map(p => (p && typeof p.path === 'string' ? p.path.trim() : ''))
      .filter(Boolean);

    let toInsert = [];
    if (newPaths.length > 0) {
      const { data: existing, error: exErr } = await supabaseAdmin
        .from('turn_photos')
        .select('storage_path')
        .eq('turn_id', turn_id)
        .in('storage_path', newPaths);

      if (exErr) throw exErr;

      const existingSet = new Set((existing || []).map(e => e.storage_path));
      toInsert = (photos || []).filter(p => p?.path && !existingSet.has(p.path));

      if (toInsert.length > 0) {
        const rows = toInsert.map(p => ({
          turn_id,
          area_key: p.area_key || null,
          storage_path: p.path
        }));
        const { error: insErr } = await supabaseAdmin.from('turn_photos').insert(rows);
        if (insErr) throw insErr;
      }
    }

    // 3) Update turn: put note, bump status back to submitted, stamp resubmitted_at
    const payload = {
      status: 'submitted',
      cleaner_reply: reply || null,
      resubmitted_at: new Date().toISOString(),
      // note: do NOT clear submitted_at; keep original or set if missing
    };
    const { error: upErr } = await supabaseAdmin
      .from('turns')
      .update(payload)
      .eq('id', turn_id);
    if (upErr) throw upErr;

    // 4) Notify manager via SMS (best-effort)
    try {
      const sender = getTwilioSender();
      const managerPhone =
        turn?.manager_link?.[0]?.managers?.phone ||
        turn?.properties?.manager_phone ||
        null;

      if (sender && managerPhone) {
        const reviewUrl = absUrl(req, `/turns/${turn_id}/review?manager=1`);
        const propertyName = turn?.properties?.name || 'a property';
        const notePart = reply ? `Cleaner note: "${reply}"\n` : '';
        const extraPart = toInsert.length > 0 ? `+ ${toInsert.length} new photo(s)\n` : '';

        const body =
          `Turn re-submitted for ${propertyName}.\n` +
          extraPart +
          notePart +
          `Review: ${reviewUrl}\n` +
          `Reply STOP to opt out • HELP for help`;

        await sender.client.messages.create({
          body,
          to: managerPhone,
          ...(sender.msgSid
            ? { messagingServiceSid: sender.msgSid }
            : { from: sender.fromNum })
        });
      }
    } catch (smsErr) {
      console.warn('resubmit-turn: SMS skipped/failed:', smsErr?.message || smsErr);
    }

    return res.json({ ok: true, inserted: toInsert.length });
  } catch (e) {
    console.error('resubmit-turn error:', e);
    return res.status(500).json({ error: e.message || 'failed' });
  }
}
