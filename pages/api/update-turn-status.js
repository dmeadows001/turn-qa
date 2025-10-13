// pages/api/update-turn-status.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

function nowIso() { return new Date().toISOString(); }
function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* fall through */ }
  }
  return req.body || {};
}

function siteBase() {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://www.turnqa.com'
  ).replace(/\/+$/, '');
}

function twilioClient() {
  if (process.env.DISABLE_SMS === '1') return null; // short-circuit in test mode
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !tok) return null;
  // lazy import to avoid cold start unless needed
  const twilio = require('twilio');
  return twilio(sid, tok);
}

async function sendSmsSafe({ to, body }) {
  try {
    // Test mode: pretend success without calling Twilio
    if (process.env.DISABLE_SMS === '1') {
      return { ok: true, testMode: true };
    }

    const client = twilioClient();
    if (!client) return { ok: false, warn: 'twilio not configured' };

    const msid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
    const from = (process.env.TWILIO_FROM_NUMBER || '').trim();
    const payload = msid ? { to, body, messagingServiceSid: msid } : { to, body, from };
    if (!payload.messagingServiceSid && !payload.from) {
      return { ok: false, warn: 'twilio from/messaging sid missing' };
    }
    const msg = await client.messages.create(payload);
    return { ok: true, sid: msg.sid };
  } catch (e) {
    console.error('[update-turn-status] SMS error', e);
    return { ok: false, warn: e.message || 'sms failed' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { turn_id, new_status, manager_note } = parseBody(req);

    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });

    const allowed = new Set(['needs_fix', 'approved']);
    if (!allowed.has(new_status)) {
      return res.status(400).json({ error: 'new_status must be needs_fix or approved' });
    }

    // Load turn with property + cleaner
    const { data: turn, error: tErr } = await supa
      .from('turns')
      .select('id, property_id, cleaner_id, status')
      .eq('id', turn_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'turn not found' });

    // Update status + timestamps + optional note
    const patch = { status: new_status };
    if (new_status === 'needs_fix') patch.needs_fix_at = nowIso();
    if (new_status === 'approved') patch.approved_at = nowIso();
    if (typeof manager_note === 'string') patch.manager_note = manager_note;

    const { error: uErr } = await supa.from('turns').update(patch).eq('id', turn_id);
    if (uErr) throw uErr;

    // Try to notify cleaners (do not fail the request if SMS fails)
    let warn = null;
    try {
      // Build recipient list: prefer the turn.cleaner_id; also include any assigned cleaners on the property
      const phones = new Set();

      if (turn.cleaner_id) {
        const { data: c } = await supa
          .from('cleaners')
          .select('phone, sms_consent, phone_verified_at, sms_opt_out_at')
          .eq('id', turn.cleaner_id)
          .maybeSingle();
        if (c?.phone && c.sms_consent && c.phone_verified_at && !c.sms_opt_out_at) phones.add(c.phone);
      }

      const { data: ass } = await supa
        .from('property_cleaners')
        .select('cleaner_id')
        .eq('property_id', turn.property_id);

      const ids = (ass || [])
        .map(a => a.cleaner_id)
        .filter(id => id && id !== turn.cleaner_id);

      if (ids.length) {
        const { data: cleaners } = await supa
          .from('cleaners')
          .select('phone, sms_consent, phone_verified_at, sms_opt_out_at')
          .in('id', ids);
        (cleaners || []).forEach(c => {
          if (c?.phone && c.sms_consent && c.phone_verified_at && !c.sms_opt_out_at) phones.add(c.phone);
        });
      }

      if (phones.size) {
        // NEW deep link to the fixes page
        const deep = `${siteBase()}/turns/${encodeURIComponent(turn_id)}/fixes`;
        const body =
          new_status === 'needs_fix'
            ? `TurnQA: A manager requested fixes. Open: ${deep}\nReply STOP to opt out, HELP for help.`
            : `TurnQA: Your turn was approved.\nReply STOP to opt out, HELP for help.`;

        // fire & forget each
        const results = await Promise.all(
          Array.from(phones).map(ph => sendSmsSafe({ to: ph, body }))
        );
        const failed = results.find(r => !r.ok);
        if (failed) warn = failed.warn || 'some SMS failed';
      }
    } catch (smsErr) {
      console.warn('[update-turn-status] notify warn:', smsErr?.message || smsErr);
      warn = smsErr?.message || 'notify failed';
    }

    return res.status(200).json({ ok: true, warn });
  } catch (e) {
    console.error('[update-turn-status] fatal', e);
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
