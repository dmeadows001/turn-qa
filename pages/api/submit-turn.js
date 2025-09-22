// pages/api/submit-turn.js
import { createClient } from '@supabase/supabase-js';
import { absUrl } from '../../lib/origin';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  // Use SERVICE ROLE so this secure API can write regardless of RLS
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// Lazy Twilio init (so builds don't fail if not configured)
function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  // eslint-disable-next-line global-require
  const Twilio = require('twilio');
  return new Twilio(sid, tok);
}

function normalizePhone(s = '') {
  const digitsOnly = (s || '').replace(/[^\d]/g, '');
  return digitsOnly ? `+${digitsOnly}` : '';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Accept both turnId and turn_id from the client
    const body = req.body || {};
    const turnId = body.turn_id || body.turnId;
    if (!turnId) return res.status(400).json({ error: 'turn_id is required' });

    // 1) Load the turn
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .select('id, property_id, status, submitted_at')
      .eq('id', turnId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Load the property (name + manager_id)
    const { data: prop, error: pErr } = await supabase
      .from('properties')
      .select('id, name, manager_id')
      .eq('id', turn.property_id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!prop) return res.status(400).json({ error: 'Property not found for this turn' });

    // 3) Load the manager (phone)
    let managerPhone = null;
    if (prop.manager_id) {
      const { data: mgr, error: mErr } = await supabase
        .from('managers')
        .select('id, phone')
        .eq('id', prop.manager_id)
        .maybeSingle();
      if (mErr) throw mErr;
      managerPhone = mgr?.phone || null;
    }
    if (!managerPhone) {
      // Fall back to a property-level phone column if you happen to have one
      // const { data: propPhone } = await supabase
      //   .from('properties').select('manager_phone').eq('id', prop.id).maybeSingle();
      // managerPhone = propPhone?.manager_phone || null;
    }

    // 4) Update turn → submitted (idempotent)
    const now = new Date().toISOString();
    const newStatus = 'submitted';
    const { error: uErr } = await supabase
      .from('turns')
      .update({ status: newStatus, submitted_at: now })
      .eq('id', turnId);
    if (uErr) throw uErr;

    // 5) Build absolute manager review link
    const reviewUrl = absUrl(req, `/turns/${turnId}/review?manager=1`);

    // 6) Send SMS to manager (if configured & phone exists)
    let sms = 'skipped_no_twilio';
    if (managerPhone) {
      const tw = getTwilio();
      if (tw && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM)) {
        const to = normalizePhone(managerPhone);
        const body =
          `TurnQA: New submission at ${prop.name || 'your property'}. Review: ${reviewUrl} ` +
          `STOP=stop HELP=help`;

        const msgOpts = { to, body };
        if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
          msgOpts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
        } else {
          msgOpts.from = process.env.TWILIO_FROM;
        }

        try {
          const sent = await tw.messages.create(msgOpts);
          sms = sent?.sid ? 'sent' : 'not_sent';
        } catch (e) {
          console.error('[submit-turn] Twilio send failed:', e?.message || e);
          sms = 'twilio_error';
        }
      } else {
        sms = 'skipped_no_twilio';
      }
    } else {
      sms = 'skipped_no_manager_phone';
    }

    return res.json({ ok: true, turn_id: turnId, status: newStatus, review_url: reviewUrl, sms });
  } catch (e) {
    console.error('[submit-turn] ERROR:', e);
    const msg = String(e?.message || e);
    return res.status(400).json({ error: msg });
  }
}
