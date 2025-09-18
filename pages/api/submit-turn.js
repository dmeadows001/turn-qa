// pages/api/submit-turn.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function baseUrl() {
  return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://www.turnqa.com')
    .replace(/\/+$/, '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    // tolerant inputs
    const turn_id = body.turn_id || body.turnId;
    const submitted_by = body.submitted_by || body.submittedBy || 'Cleaner';
    const notes = body.notes || body.message || '';
    // photos may be present; we ignore them for now to keep this endpoint lean
    // const photos = Array.isArray(body.photos) ? body.photos : [];

    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });

    // 1) Load the turn (need property_id for manager lookup)
    const { data: turn, error: tErr } = await supa
      .from('turns')
      .select('id, property_id, status, submitted_at')
      .eq('id', turn_id)
      .single();
    if (tErr || !turn) throw new Error('Turn not found');

    // 2) Update the turn as submitted (keep update minimal to avoid schema mismatches)
    const { error: uErr } = await supa
      .from('turns')
      .update({ submitted_at: new Date().toISOString(), status: 'submitted' })
      .eq('id', turn_id);
    if (uErr) throw uErr;

    // 3) Resolve manager phone + consent
    // Try manager_turns first (most flexible: many managers per property over time)
    let managerPhone = null;
    let managerConsent = false;
    let managerName = null;

    const { data: mt } = await supa
      .from('manager_turns')
      .select('manager_id')
      .eq('property_id', turn.property_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let managerId = mt?.manager_id;

    // Fallback to properties.manager_id if present in your schema
    if (!managerId) {
      const { data: propRow } = await supa
        .from('properties')
        .select('manager_id')
        .eq('id', turn.property_id)
        .maybeSingle();
      managerId = propRow?.manager_id || null;
    }

    if (managerId) {
      const { data: mgr } = await supa
        .from('managers')
        .select('name, phone, sms_consent')
        .eq('id', managerId)
        .maybeSingle();
      managerPhone = mgr?.phone || null;
      managerConsent = !!mgr?.sms_consent;
      managerName = mgr?.name || null;
    }

    // Also load property name for the message (optional; we’ll keep body short on trial)
    const { data: prop } = await supa
      .from('properties')
      .select('name')
      .eq('id', turn.property_id)
      .maybeSingle();

    const reviewLink = `${baseUrl()}/turns/${turn_id}/review`;

    // 4) Send SMS to manager (only if consented and phone present)
    let sms = 'skipped';
    if (managerPhone && managerConsent) {
      const { default: twilio } = await import('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

      // keep short for Twilio trial accounts
      const bodyText = `TurnQA: Submitted. Review: ${reviewLink} STOP=stop`;

      const opts = { to: managerPhone, body: bodyText };
      if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
        opts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      } else {
        opts.from = process.env.TWILIO_FROM_NUMBER;
      }

      const msg = await client.messages.create(opts);
      sms = msg?.sid ? 'sent' : 'queued';
    }

    // (Optional) you could insert an audit log row here if you have audit_log table

    return res.status(200).json({
      ok: true,
      turn_id,
      manager_sms: sms,
      review_link: reviewLink,
      submitted_by,
      notes
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
