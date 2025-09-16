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

    // 1) Load the turn + property (no cleaner embed to avoid FK requirement)
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .select(`
        id,
        property_id,
        cleaner_id,
        status,
        properties:property_id ( name )
      `)
      .eq('id', turn_id)
      .single();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Fetch cleaner by id (separate query; no FK embed needed)
    let cleaner = null;
    if (turn.cleaner_id) {
      const { data: c, error: cErr } = await supabase
        .from('cleaners')
        .select('id, name, phone')
        .eq('id', turn.cleaner_id)
        .single();
      if (cErr) throw cErr;
      cleaner = c;
    }

    // 3) Update status → approved
    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabase
      .from('turns')
      .update({ status: 'approved', approved_at: nowIso })
      .eq('id', turn_id);
    if (upErr) throw upErr;

    // 4) Log event
    const { error: evErr } = await supabase
      .from('turn_events')
      .insert({
        turn_id,
        event: 'approved',
        meta: { approved_by }
      });
    if (evErr) throw evErr;

    // 5) Optional payout
    let payout = { ok: false, reason: 'no cleaner or amount' };
    if (cleaner?.id && Number.isFinite(Number(payout_amount_cents)) && Number(payout_amount_cents) > 0) {
      payout = await sendCleanerPayout({
        turnId: turn_id,
        cleanerId: cleaner.id,
        amountCents: Number(payout_amount_cents)
      });
    }

    // 6) Notify cleaner
    const propertyName = turn?.properties?.name || 'Property';
    const FOOTER = ' Reply STOP to opt out, HELP for help.';
    let sms = 'skipped';

    if (cleaner?.phone && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER)) {
      const body = `TurnQA: Your turn for "${propertyName}" was approved.${payout.ok ? ' Your payout is being processed.' : ''}${FOOTER}`;
      const opts = { to: cleaner.phone, body };
      if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
        opts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      } else {
        opts.from = process.env.TWILIO_FROM_NUMBER;
      }
      await twilioClient.messages.create(opts);
      sms = 'sent';
    }

    return res.status(200).json({ ok: true, payout_ok: !!payout.ok, sms });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
