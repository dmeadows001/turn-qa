// pages/api/submit-turn.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// Utils
function canSendSMS(rec) {
  if (!rec) return { ok: false, reason: 'no_recipient' };
  if (!rec.phone) return { ok: false, reason: 'no_phone' };
  if (rec.sms_consent !== true) return { ok: false, reason: 'no_consent' };
  if (rec.sms_opt_out_at) return { ok: false, reason: 'opted_out' };
  // Optional: require verified phones only
  // if (!rec.phone_verified_at) return { ok: false, reason: 'unverified_phone' };
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { turn_id, submitted_by, notes } = req.body || {};
    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });

    // 1) Load the turn and its property (get manager_id + property name)
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .select(`
        id,
        property_id,
        status,
        submitted_at,
        properties:property_id ( id, name, manager_id )
      `)
      .eq('id', turn_id)
      .single();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Fetch the manager (separate query so we don't depend on FK embeds)
    let manager = null;
    if (turn.properties?.manager_id) {
      const { data: m, error: mErr } = await supabase
        .from('managers')
        .select('id, name, phone, sms_consent, sms_opt_out_at, phone_verified_at')
        .eq('id', turn.properties.manager_id)
        .single();
      if (mErr) throw mErr;
      manager = m;
    }

    // 3) Update turn status → submitted
    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabase
      .from('turns')
      .update({ status: 'submitted', submitted_at: nowIso })
      .eq('id', turn_id);
    if (upErr) throw upErr;

    // 4) Log event
    const { error: evErr } = await supabase
      .from('turn_events')
      .insert({
        turn_id,
        event: 'submitted',
        meta: { submitted_by, notes }
      });
    if (evErr) throw evErr;

    // 5) Consent guard + send SMS
    const guard = canSendSMS(manager);
    const propertyName = turn?.properties?.name || 'Property';
    const reviewUrl = `${process.env.APP_BASE_URL || ''}/turns/${turn_id}/review`;
    const FOOTER = ' Reply STOP to opt out, HELP for help.';
    let sms = { attempted: false, sent: false, reason: null, sid: null };

    if (guard.ok && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER)) {
      const { default: twilio } = await import('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

      const body = `TurnQA: A turn was submitted for "${propertyName}". Review: ${reviewUrl}.${FOOTER}`;
      const opts = { to: manager.phone, body };
      if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
        opts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      } else {
        opts.from = process.env.TWILIO_FROM_NUMBER;
      }

      sms.attempted = true;
      const msg = await client.messages.create(opts);
      sms.sent = true;
      sms.sid = msg.sid;
    } else {
      sms.reason = guard.ok ? 'no_sender_config' : guard.reason;
    }

    return res.status(200).json({ ok: true, sms });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
