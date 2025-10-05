// pages/api/invite/cleaner.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Handle both export styles (function returning a client vs direct client)
const supa = typeof _admin === 'function' ? _admin() : _admin;

// --- helpers ---
function normPhone(raw = '') {
  const only = String(raw || '').replace(/[^\d+]/g, '');
  if (!only) return '';
  if (only.startsWith('+')) return only;
  if (/^\d{10}$/.test(only)) return `+1${only}`; // naive US default
  return `+${only}`;
}

function getSiteUrl(req) {
  // Prefer explicit envs if set on Vercel
  const envSite =
    (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim();
  if (envSite) return envSite.replace(/\/+$/, '');
  // Fallback to request host/proto
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function getTwilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
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

  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const from =
    (process.env.TWILIO_FROM || '').trim() ||
    (process.env.TWILIO_FROM_NUMBER || '').trim() ||
    (process.env.TWILIO_PHONE_NUMBER || '').trim();

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
  if (req.method !== 'POST') { res.setHeader('Allow', ['POST']); return res.status(405).json({ error: 'Method Not Allowed' }); }

  try {
    const { property_id, phone: rawPhone, name: rawName } = req.body || {};
    const phone = normPhone(rawPhone);
    const name = (rawName || '').toString().trim();

    if (!property_id) return res.status(400).json({ error: 'property_id required' });
    if (!phone)       return res.status(400).json({ error: 'valid phone required' });

    // 1) Ensure the property exists (nice error if not)
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
        .insert({ phone, name: name || null, sms_consent: false })
        .select('id, phone, name, sms_consent')
        .single();
      if (iErr) throw iErr;
      cleaner = created;
    } else if (name && !cleaner.name) {
      // tiny enhancement: backfill a name if we were just given one
      await supa.from('cleaners').update({ name }).eq('id', cleaner.id).limit(1);
    }

    // 3) Link cleaner to property (idempotent with unique (property_id, cleaner_id))
    try {
      const { error: lErr } = await supa
        .from('property_cleaners')
        .upsert({ property_id, cleaner_id: cleaner.id }, { onConflict: 'property_id,cleaner_id' });
      if (lErr) throw lErr;
    } catch (e) {
      // If unique constraint throws a duplicate error under some PG versions, ignore it
      const msg = (e?.message || '').toLowerCase();
      if (!msg.includes('duplicate')) throw e;
    }

    // 4) Text the cleaner a short invite pointing to /capture
    const site = getSiteUrl(req);
    const shortBody = `TurnQA: You’ve been added to ${prop.name || 'a property'}. Start your turn at ${site}/capture (Reply STOP to opt out)`;
    const sms = await sendInviteSMS({ to: phone, body: shortBody });

    return res.json({
      ok: true,
      cleaner_id: cleaner.id,
      property_id,
      linked: true,
      sms
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'invite failed' });
  }
}
