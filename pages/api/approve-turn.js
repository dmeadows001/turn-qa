// pages/api/approve-turn.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// Replace later with Stripe Connect / Routable / PayPal Payouts
async function sendCleanerPayout({ turnId, cleanerId, amountCents, currency = 'USD' }) {
  return { ok: true, id: `demo_${turnId}` };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { default: twilio } = await import('twilio');
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const { turn_id, approved_by, payout_amount_cents } = req.body || {};
    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });

    // 1) Load the turn with property and cleaner
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .select(`
        id,
        property_id,
        cleaner_id,
        status,
        properties:property_id ( name ),
        cleaners:cleaner_id ( id, name, phone )
      `)
      .eq('id', turn_id)
      .single();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Update status → approved
    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabase
      .from('turns')
      .update({ status: 'approved', approved_at: nowIso })
      .eq('id', turn_id);
    if (upErr) throw upErr;

    // 3) Log event
    const { error: evErr } = await supabase
      .from('turn_events')
      .insert({
        turn_id,
        event: 'approved',
        meta: { approved_by }
      });
    if (evErr) throw evErr;

    // 4) Optional payout
    let payout = { ok: false, reason: 'no cleaner or amount' };
    if (turn.cleaners?.id && Number.isFinite(Number(payout_amount_cents)) && Number(payout_amount_cents) > 0) {
      payout = await sendCleanerPayout({
        turnId: turn_id,
        cleanerId: turn.cleaners.id,
        amountCents: Number(payout_amount_cents)
      });
    }

    // 5) Notify cleaner (DB-driven) + compliance footer
    const cleanerPhone = turn?.cleaners?.phone;
    const propertyName = turn?.properties?.name || 'Property';
    const FOOTER = ' Reply STOP to opt out, HELP for help.';

    let sms = 'skipped';
    if (cleanerPhone && process.env.TWILIO_FROM_NUMBER) {
      const paid = payout.ok ? ' Your payout is being processed.' : '';
      const body = `TurnQA: Your turn for "${propertyName}" was approved.${paid}${FOOTER}`;
      await twilioClient.messages.create({
        from: process.env.TWILIO_FROM_NUMBER,
        to: cleanerPhone,
        body
      });
      sms = 'sent';
    }

    return res.status(200).json({ ok: true, payout_ok: !!payout.ok, sms });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
