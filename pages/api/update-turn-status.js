// pages/api/update-turn-status.js
import { createClient } from '@supabase/supabase-js';

// ---- Supabase (server-side) ----
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  // Prefer service role on the server, fall back to anon if needed (less perms)
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ---- Helpers ----
function getSiteUrl(req) {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function normPhone(raw = '') {
  const only = String(raw || '').replace(/[^\d+]/g, '');
  if (!only) return '';
  if (only.startsWith('+')) return only;
  if (/^\d{10}$/.test(only)) return `+1${only}`;
  return `+${only}`;
}

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  try {
    // eslint-disable-next-line global-require
    const twilio = require('twilio');
    return twilio(sid, token);
  } catch {
    return null;
  }
}

async function sendSMS({ to, body }) {
  const client = getTwilioClient();
  if (!client) return { ok: false, reason: 'twilio_not_configured' };

  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
  const from = process.env.TWILIO_FROM_NUMBER || '';

  const msg = {
    to,
    body,
    ...(messagingServiceSid ? { messagingServiceSid } : from ? { from } : {})
  };

  if (!msg.messagingServiceSid && !msg.from) {
    return { ok: false, reason: 'sender_not_configured' };
  }

  try {
    const resp = await client.messages.create(msg);
    return { ok: true, sid: resp.sid };
  } catch (e) {
    return { ok: false, reason: e?.message || 'send_failed' };
  }
}

// ---- Handler ----
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { turn_id, new_status, manager_note } = req.body || {};
    if (!turn_id) return res.status(400).json({ error: 'turn_id required' });

    const allowed = new Set(['approved', 'needs_fix', 'submitted', 'in_progress', 'cancelled']);
    if (!allowed.has(String(new_status || ''))) {
      return res.status(400).json({ error: 'invalid new_status' });
    }

    // 1) Load current turn context
    const { data: turn, error: tErr } = await supa
      .from('turns')
      .select('id, status, cleaner_id, property_id, submitted_at, approved_at, needs_fix_at')
      .eq('id', turn_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Build update patch (timestamps)
    const nowIso = new Date().toISOString();
    const patch = { status: new_status, manager_notes: manager_note || null };

    if (new_status === 'approved') {
      patch.approved_at = nowIso;
      // Clear needs_fix if previously set
      patch.needs_fix_at = turn.needs_fix_at || null;
    } else if (new_status === 'needs_fix') {
      patch.needs_fix_at = nowIso;
      // If marking needs_fix from submitted, keep approved_at null
      patch.approved_at = null;
    }

    // 3) Apply update
    const { data: updated, error: uErr } = await supa
      .from('turns')
      .update(patch)
      .eq('id', turn_id)
      .select('id, status, cleaner_id, property_id, approved_at, needs_fix_at')
      .single();

    if (uErr) throw uErr;

    // 4) Optional: on approval, notify cleaner by SMS (short body)
    let sms = { skipped: true };
    if (new_status === 'approved' && updated?.cleaner_id) {
      // Load cleaner + property for message
      const [{ data: cleaner }, { data: prop }] = await Promise.all([
        supa.from('cleaners').select('id, phone, sms_consent, name').eq('id', updated.cleaner_id).maybeSingle(),
        supa.from('properties').select('id, name').eq('id', updated.property_id).maybeSingle()
      ]);

      const phone = normPhone(cleaner?.phone || '');
      const consent = cleaner?.sms_consent === true;

      if (phone && consent) {
        // Keep message very short (trial-safe, and good UX)
        const site = getSiteUrl(req);
        const propertyName = prop?.name || 'your property';
        const body = `TurnQA: Approved ✅ ${propertyName}. Thanks! Reply STOP to opt out.`;
        sms = await sendSMS({ to: phone, body });
      } else {
        sms = { skipped: true, reason: !phone ? 'no_phone' : 'no_consent' };
      }
    }

    return res.json({ ok: true, turn: updated, sms });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'update failed' });
  }
}
