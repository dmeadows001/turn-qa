// pages/api/update-turn-status.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

function nowIso() { return new Date().toISOString(); }
const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.turnqa.com';

function twilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !tok) return null;
  const { default: twilio } = require('twilio');
  return twilio(sid, tok);
}

async function notifyCleanersNeedsFix(turn) {
  // turn: { id, property_id }
  const client = twilioClient();
  if (!client) return; // no-op if Twilio not configured

  const msid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const from = (process.env.TWILIO_FROM_NUMBER || '').trim();

  // Find all cleaners assigned to this property (adjust if you target a specific cleaner)
  const { data: rows, error } = await supa
    .from('property_cleaners')
    .select('cleaners ( phone, sms_opt_out_at, name )')
    .eq('property_id', turn.property_id);

  if (error || !rows?.length) return;

  const link = `${SITE_ORIGIN}/turns/${turn.id}/capture`;
  const body = `A manager requested fixes on your recent turn. Open: ${link} (Reply STOP to opt out)`;

  const targets = rows
    .map(r => r?.cleaners)
    .filter(c => c?.phone && !c?.sms_opt_out_at);

  await Promise.all(
    targets.map(c =>
      client.messages.create({
        to: c.phone,
        ...(msid ? { messagingServiceSid: msid } : { from }),
        body
      }).catch(() => null)
    )
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { turn_id, new_status, manager_note } = req.body || {};
    if (!turn_id || !new_status) {
      return res.status(400).json({ error: 'turn_id and new_status are required' });
    }

    // Only allow specific transitions
    const allowed = new Set(['needs_fix', 'approved']);
    if (!allowed.has(new_status)) {
      return res.status(400).json({ error: 'new_status must be needs_fix or approved' });
    }

    // Load the turn (we need property_id for notifications)
    const { data: turn, error: tErr } = await supa
      .from('turns')
      .select('id, property_id, status')
      .eq('id', turn_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // Update turn status + timestamps
    const patch = { status: new_status };
    if (new_status === 'needs_fix') patch.needs_fix_at = nowIso();
    if (new_status === 'approved') patch.approved_at = nowIso();

    const { error: upErr } = await supa
      .from('turns')
      .update(patch)
      .eq('id', turn_id);
    if (upErr) throw upErr;

    // Optional: record manager note
    if (manager_note) {
      await supa.from('turn_notes').insert({
        turn_id,
        who: 'manager',
        note: String(manager_note).slice(0, 2000),
        created_at: nowIso()
      }).catch(() => null);
    }

    // 🔔 If needs_fix → notify assigned cleaners with a deep link
    if (new_status === 'needs_fix') {
      notifyCleanersNeedsFix({ id: turn_id, property_id: turn.property_id }).catch(() => {});
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'update-turn-status failed' });
  }
}
