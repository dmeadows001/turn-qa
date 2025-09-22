// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  // Use the SERVICE ROLE so this route can create/link rows regardless of RLS
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const twilioSid  = process.env.TWILIO_ACCOUNT_SID || '';
const twilioTok  = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFrom = process.env.TWILIO_FROM || ''; // e.g. +18885551234
const twilioMSID = process.env.TWILIO_MESSAGING_SERVICE_SID || '';

let twilioClient = null;
if (twilioSid && twilioTok) {
  // Lazy require avoids bundling errors if creds are missing
  // eslint-disable-next-line global-require
  const Twilio = require('twilio');
  twilioClient = new Twilio(twilioSid, twilioTok);
}

function normUS(phone) {
  const digits = (phone || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return digits;
}

export default async function handler(req, res) {
  // Allow quick “alive” checks and avoid 405 on preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(200).end();
  }
  if (req.method === 'GET') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(200).json({ ok: true, route: '/api/invite/cleaner', accepts: ['POST'] });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { property_id, cleaner_name, phone } = req.body || {};
    if (!property_id) throw new Error('property_id is required');
    if (!cleaner_name || !phone) throw new Error('cleaner_name and phone are required');

    // Ensure property exists
    const { data: prop, error: pErr } = await supabaseAdmin
      .from('properties')
      .select('id, name')
      .eq('id', property_id)
      .single();
    if (pErr || !prop) throw new Error(`Property not found or not accessible: ${pErr?.message || 'unknown'}`);

    // Normalize phone
    const e164 = normUS(phone);
    if (!e164) throw new Error('Invalid phone number');

    // Find or create cleaner
    let { data: cleaner, error: cFindErr } = await supabaseAdmin
      .from('cleaners')
      .select('id, name, phone, sms_consent')
      .eq('phone', e164)
      .maybeSingle();
    if (cFindErr) throw cFindErr;

    if (!cleaner) {
      const { data: created, error: cInsErr } = await supabaseAdmin
        .from('cleaners')
        .insert({ name: cleaner_name.trim(), phone: e164, sms_consent: false })
        .select('id, name, phone, sms_consent')
        .single();
      if (cInsErr) throw cInsErr;
      cleaner = created;
    } else if (!cleaner.name && cleaner_name) {
      await supabaseAdmin.from('cleaners').update({ name: cleaner_name.trim() }).eq('id', cleaner.id);
    }

    // Link cleaner to property (ignore duplicate pair)
    const { error: linkErr } = await supabaseAdmin
      .from('property_cleaners')
      .insert({ property_id, cleaner_id: cleaner.id })
      .select()
      .maybeSingle();
    if (linkErr && !/duplicate key/i.test(linkErr.message)) throw linkErr;

    // If Twilio not configured, skip SMS but succeed (useful during setup)
    if (!twilioClient || (!twilioMSID && !twilioFrom)) {
      console.warn('[invite/cleaner] Twilio not configured; skipping SMS.');
      return res.json({ ok: true, sms: 'skipped_no_twilio' });
    }

    // Very short trial-safe body (Twilio Trial auto-prefixes its own line too)
    const firstName = (cleaner_name || '').split(/\s+/)[0] || 'Cleaner';
    const body = `TurnQA: ${firstName}, invited to ${prop.name}. We’ll text job links. STOP=stop HELP=help`;

    const msgOpts = { to: e164, body };
    if (twilioMSID) msgOpts.messagingServiceSid = twilioMSID;
    else msgOpts.from = twilioFrom;

    const tw = await twilioClient.messages.create(msgOpts);
    return res.json({ ok: true, sms: 'sent', sid: tw.sid });
  } catch (e) {
    console.error('[invite/cleaner] ERROR:', e);
    return res.status(400).json({ error: e.message || 'invite failed' });
  }
}
