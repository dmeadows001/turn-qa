
 // pages/api/update-turn-status.js
import { requireActiveSubscription } from '@/lib/requireActiveSubscription';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

function nowIso() {
  return new Date().toISOString();
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      // Fall through
    }
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
  if (process.env.DISABLE_SMS === '1') return null;

  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok = (process.env.TWILIO_AUTH_TOKEN || '').trim();

  if (!sid || !tok) return null;

  const twilio = require('twilio');
  return twilio(sid, tok);
}

async function sendSmsSafe({ to, body }) {
  try {
    if (process.env.DISABLE_SMS === '1') {
      return { ok: true, testMode: true };
    }

    const client = twilioClient();

    if (!client) {
      return { ok: false, warn: 'twilio not configured' };
    }

    const msid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
    const from = (process.env.TWILIO_FROM_NUMBER || '').trim();

    const payload = msid
      ? { to, body, messagingServiceSid: msid }
      : { to, body, from };

    if (!payload.messagingServiceSid && !payload.from) {
      return {
        ok: false,
        warn: 'twilio from/messaging sid missing'
      };
    }

    const msg = await client.messages.create(payload);

    return { ok: true, sid: msg.sid };
  } catch (e) {
    console.error('[update-turn-status] SMS error', e);
    return {
      ok: false,
      warn: e.message || 'sms failed'
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Only authenticated managers with an active subscription
  // can update turnover status.
  const access = await requireActiveSubscription(req, res);

  if (!access.ok) return;

  try {
    const { turn_id, new_status, manager_note } = parseBody(req);

    if (!turn_id) {
      return res.status(400).json({
        error: 'turn_id is required'
      });
    }

    const allowed = new Set(['needs_fix', 'approved']);

    if (!allowed.has(new_status)) {
      return res.status(400).json({
        error: 'new_status must be needs_fix or approved'
      });
    }

    // Load the turnover.
    const { data: turn, error: tErr } = await supa
      .from('turns')
      .select('id, property_id, cleaner_id, status')
      .eq('id', turn_id)
      .maybeSingle();

    if (tErr) throw tErr;

    if (!turn) {
      return res.status(404).json({
        error: 'turn not found'
      });
    }

    // Verify the authenticated manager account.
    const { data: manager, error: mErr } = await supa
      .from('managers')
      .select('id')
      .eq('user_id', access.user.id)
      .maybeSingle();

    if (mErr) throw mErr;

    if (!manager) {
      return res.status(403).json({
        error: 'Manager account not found'
      });
    }

    // Verify that the manager owns this property's turnover.
    const { data: property, error: pErr } = await supa
      .from('properties')
      .select('id')
      .eq('id', turn.property_id)
      .eq('manager_id', manager.id)
      .maybeSingle();

    if (pErr) throw pErr;

    if (!property) {
      return res.status(404).json({
        error: 'Turnover not found or access denied'
      });
    }

    // Update status, timestamps, and optional manager note.
    const patch = { status: new_status };

    if (new_status === 'needs_fix') {
      patch.needs_fix_at = nowIso();
    }

    if (new_status === 'approved') {
      patch.approved_at = nowIso();
    }

    if (typeof manager_note === 'string') {
      patch.manager_note = manager_note;
    }

    const { error: uErr } = await supa
      .from('turns')
      .update(patch)
      .eq('id', turn_id);

    if (uErr) throw uErr;

    // Notify ONLY the cleaner who performed this turnover.
    // Never fall back to other property-authorized cleaners.
    let warn = null;

    try {
      if (!turn.cleaner_id) {
        warn = 'No cleaner assigned to this turnover; SMS skipped';
      } else {
        const { data: cleaner, error: cErr } = await supa
          .from('cleaners')
          .select(
            'phone, sms_consent, phone_verified_at, sms_opt_out_at'
          )
          .eq('id', turn.cleaner_id)
          .maybeSingle();

        if (cErr) throw cErr;

        if (!cleaner) {
          warn = 'Turnover cleaner not found; SMS skipped';
        } else if (!cleaner.phone) {
          warn = 'Cleaner has no phone; SMS skipped';
        } else if (
          cleaner.sms_consent !== true ||
          !cleaner.phone_verified_at ||
          cleaner.sms_opt_out_at
        ) {
          warn = 'Cleaner is not eligible for SMS; SMS skipped';
        } else {
          const deep = `${siteBase()}/turns/${encodeURIComponent(turn_id)}/fixes`;

          const body =
            new_status === 'needs_fix'
              ? `TurnQA: A manager requested fixes. Open: ${deep}\nReply STOP to opt out, HELP for help.`
              : 'TurnQA: Your turn was approved.\nReply STOP to opt out, HELP for help.';

          const result = await sendSmsSafe({
            to: cleaner.phone,
            body
          });

          if (!result.ok) {
            warn = result.warn || 'SMS failed';
          }
        }
      }
    } catch (smsErr) {
      console.warn(
        '[update-turn-status] notify warn:',
        smsErr?.message || smsErr
      );

      warn = smsErr?.message || 'notify failed';
    }

    return res.status(200).json({
      ok: true,
      warn
    });
  } catch (e) {
    console.error('[update-turn-status] fatal', e);

    return res.status(500).json({
      error: e.message || 'unexpected error'
    });
  }
}
