// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// --- helpers ---
function normPhone(raw = '') {
  const only = (raw || '').replace(/[^\d+]/g, '');
  if (!only) return '';
  if (only.startsWith('+')) return only;
  if (/^\d{10}$/.test(only)) return `+1${only}`;
  return `+${only}`;
}

function getSiteUrl(req) {
  // Prefer explicit env if you have it set in Vercel
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  // Fallback to request host (Vercel/Prod)
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  return `${proto}://${host}`;
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

async function sendInviteSMS({ to, body }) {
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

// --- handler ---
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { property_id, phone: rawPhone, name: rawName } = req.body || {};
    const phone = normPhone(String(rawPhone || ''));
    const name = (rawName || '').toString().trim();

    if (!property_id) return res.status(400).json({ error: 'property_id required' });
    if (!phone) return res.status(400).json({ error: 'valid phone required' });

    // 1) Ensure the property exists (optional safety)
    const { data: prop, error: pErr } = await supa
      .from('properties')
      .select('id, name')
      .eq('id', property_id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!prop) return res.status(404).json({ error: 'property not found' });

    // 2) Find or create the cleaner by phone
    let { data: cleaner, error: cErr } = await supa
      .from('cleaners')
      .select('id, phone, name, sms_consent')
      .eq('phone', phone)
      .maybeSingle();
    if (cErr) throw cErr;

    if (!cleaner) {
      const { data: created, error: iErr } = await supa
        .from('cleaners')
        .insert({ phone, name: name || null, sms_consent: null })
        .select('id, phone, name, sms_consent')
        .single();
      if (iErr) throw iErr;
      cleaner = created;
    } else if (name && !cleaner.name) {
      // tiny enhancement: backfill a name if we were just given one
      await supa.from('cleaners').update({ name }).eq('id', cleaner.id).limit(1);
    }

    // 3) Link cleaner to property so it appears in their /capture dropdown
    // Requires a unique constraint on (property_id, cleaner_id) or will allow duplicates.
    // If you don't have it:
    //   create unique index if not exists ux_property_cleaners
    //     on property_cleaners(property_id, cleaner_id);
    let linked = false;
    try {
      const { data: link, error: lErr } = await supa
        .from('property_cleaners')
        .insert({ property_id, cleaner_id: cleaner.id })
        .select('property_id, cleaner_id')
        .single();
      if (lErr && !String(lErr.message || '').toLowerCase().includes('duplicate')) throw lErr;
      linked = true;
    } catch {
      // if duplicate constraint exists, we ignore duplicates
      linked = true;
    }

    // 4) SMS the cleaner a short invite (no invite-id needed; new flow uses /capture)
    const site = getSiteUrl(req);
    const shortBody = `TurnQA: You’ve been added to ${prop.name || 'a property'}. Start your turn at ${site}/capture (Reply STOP to opt out)`;

    const sms = await sendInviteSMS({ to: phone, body: shortBody });

    return res.json({
      ok: true,
      cleaner_id: cleaner.id,
      property_id,
      linked,
      sms
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'invite failed' });
  }
}
