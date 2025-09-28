// pages/api/update-turn-status.js
import { supabaseAdmin } from '../../lib/supabase';

function getTwilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  try {
    // lazy-require so missing module never breaks the API if SMS isn't configured
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const Twilio = require('twilio');
    return new Twilio(sid, token);
  } catch {
    return null;
  }
}

function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { turn_id, new_status, manager_note } = (req.body || {});
    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });

    const allowed = new Set(['needs_fix', 'approved']);
    if (!allowed.has(new_status)) {
      return res.status(400).json({ error: 'new_status must be needs_fix or approved' });
    }

    const patch = {
      status: new_status,
      manager_notes: (manager_note ?? '').trim() || null,
    };
    if (new_status === 'approved') {
      patch.approved_at = new Date().toISOString();
    } else if (new_status === 'needs_fix') {
      patch.approved_at = null; // clear approval timestamp if sending back for fixes
    }

    // 1) Persist first — never let SMS failures block DB state
    const { data: updated, error } = await supabaseAdmin
      .from('turns')
      .update(patch)
      .eq('id', turn_id)
      .select('id, status, manager_notes, cleaner_id')
      .single();

    if (error) throw error;
    if (!updated) return res.status(404).json({ error: 'Turn not found' });

    // 2) Try to notify cleaner via SMS (best effort)
    let sms = 'skipped';
    try {
      const client = getTwilioClient();
      if (client && updated.cleaner_id) {
        const { data: cleaner, error: cErr } = await supabaseAdmin
          .from('cleaners')
          .select('phone, sms_consent, name')
          .eq('id', updated.cleaner_id)
          .single();

        if (!cErr && cleaner?.sms_consent && cleaner?.phone) {
          const to = normalizePhone(cleaner.phone);

          const footer = ' Reply STOP to opt out, HELP for help.';
          let body = '';
          if (new_status === 'approved') {
            body = `TurnQA: Your turn was approved ✅.${footer}`;
          } else {
            const note = (patch.manager_notes ? ` Note: ${patch.manager_notes}` : '');
            body = `TurnQA: Manager requested fixes 🛠️.${note}${footer}`;
          }

          const useSvc = !!process.env.TWILIO_MESSAGING_SERVICE_SID;
          await client.messages.create({
            to,
            ...(useSvc
              ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
              : { from: process.env.TWILIO_FROM_NUMBER }),
            body,
          });
          sms = 'sent';
        }
      }
    } catch (e) {
      // Don’t fail the request if SMS has issues
      console.error('update-turn-status: SMS send failed:', e?.message || e);
      sms = 'failed';
    }

    return res.status(200).json({
      ok: true,
      status: updated.status,
      manager_notes: updated.manager_notes,
      sms,
    });
  } catch (e) {
    console.error('update-turn-status error:', e);
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
