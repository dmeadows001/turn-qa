// pages/api/submit-turn.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Lazy-load Twilio so it's server-only
    const { default: twilio } = await import('twilio');
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const { turn_id, submitted_by, notes } = req.body || {};
    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });

    // 1) Load the turn and its property/manager
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .select(`
        id,
        property_id,
        status,
        properties:property_id (
          id,
          name,
          manager_id,
          managers:manager_id ( id, name, phone )
        )
      `)
      .eq('id', turn_id)
      .single();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Update turn status → submitted
    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabase
      .from('turns')
      .update({ status: 'submitted', submitted_at: nowIso })
      .eq('id', turn_id);
    if (upErr) throw upErr;

    // 3) Log event
    const { error: evErr } = await supabase
      .from('turn_events')
      .insert({
        turn_id,
        event: 'submitted',
        meta: { submitted_by, notes }
      });
    if (evErr) throw evErr;

    // 4) Notify manager (DB-driven) + compliance footer
    const managerPhone = turn?.properties?.managers?.phone;
    const propertyName = turn?.properties?.name || 'Property';
    const FOOTER = ' Reply STOP to opt out, HELP for help.';

    let sms = 'skipped';
    if (managerPhone && process.env.TWILIO_FROM_NUMBER) {
      const reviewUrl = `${process.env.APP_BASE_URL || ''}/turns/${turn_id}/review`;
      const body = `TurnQA: A turn was submitted for "${propertyName}". Review: ${reviewUrl}.${FOOTER}`;
      await twilioClient.messages.create({
        from: process.env.TWILIO_FROM_NUMBER,
        to: managerPhone,
        body
      });
      sms = 'sent';
    }

    return res.status(200).json({ ok: true, sms });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
