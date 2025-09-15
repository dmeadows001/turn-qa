// pages/api/submit-turn.js
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// Twilio client (SMS only)
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { turn_id, submitted_by, notes } = req.body || {};
    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });

    // 1) Ensure the turn exists
    const { data: turnRow, error: turnErr } = await supabase
      .from('turns')
      .select('id, property_id, status')
      .eq('id', turn_id)
      .single();
    if (turnErr) throw turnErr;
    if (!turnRow) return res.status(404).json({ error: 'Turn not found' });

    // 2) Update turn state to submitted
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

    // 4) Look up manager phone via property -> manager
    // Adjust select path to your schema. Assumes:
    // - properties.manager_id -> managers.id
    // - managers has columns: name, phone (E.164 recommended, e.g. +16265551234)
    const { data: prop, error: propErr } = await supabase
      .from('properties')
      .select('id, name, manager_id, managers:manager_id ( id, name, phone )')
      .eq('id', turnRow.property_id)
      .single();
    if (propErr) throw propErr;

    const managerPhone = prop?.managers?.phone;
    const managerName  = prop?.managers?.name || 'Manager';
    const propertyName = prop?.name || 'Property';

    let smsStatus = 'skipped';
    if (managerPhone) {
      const reviewUrl = `${process.env.APP_BASE_URL || ''}/turns/${turn_id}/review`;
      const body = `TurnQA: A turn was submitted for "${propertyName}". Review: ${reviewUrl}`;
      await twilioClient.messages.create({
        from: process.env.TWILIO_FROM_NUMBER, // e.g. "+18445551234"
        to: managerPhone,
        body
      });
      smsStatus = 'sent';
    }

    return res.status(200).json({ ok: true, sms: smsStatus });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
