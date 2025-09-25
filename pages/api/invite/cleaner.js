// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

// --- Supabase (service role so RLS won't block server writes) ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// --- helpers ---
function normalizePhone(s = '') {
  const d = String(s || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  return d.startsWith('+') ? d : `+${d}`;
}

function absUrl(req, path = '/') {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host  = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0];
  const p     = path.startsWith('/') ? path : `/${path}`;
  return `${proto}://${host}${p}`;
}

// robust invite upsert using (property_id, cleaner_id)
async function upsertInvite({ property_id, cleaner_id }) {
  // preferred: onConflict composite unique (property_id, cleaner_id)
  try {
    const { data, error } = await supabase
      .from('cleaner_invites')
      .upsert(
        { property_id, cleaner_id },
        { onConflict: 'property_id,cleaner_id' }
      )
      .select('id')
      .single();
    if (!error && data?.id) return data.id;
    if (error) throw error;
  } catch (_e) {
    // fall through to plain insert/select if unique index not present
  }

  // plain insert → if duplicate, select existing
  const ins = await supabase
    .from('cleaner_invites')
    .insert({ property_id, cleaner_id })
    .select('id')
    .maybeSingle();

  if (ins.data?.id) return ins.data.id;

  if (ins.error && /duplicate key value|23505/i.test(ins.error.message || '')) {
    const sel = await supabase
      .from('cleaner_invites')
      .select('id')
      .eq('property_id', property_id)
      .eq('cleaner_id', cleaner_id)
      .maybeSingle();
    if (sel.data?.id) return sel.data.id;
  }

  // if we still couldn't get an id, throw the last error
  throw new Error(ins.error?.message || 'Could not create or fetch invite');
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
    const { property_id, phone, name = '' } = req.body || {};
    if (!property_id) return res.status(400).json({ error: 'property_id is required' });
    const e164 = normalizePhone(phone);
    if (!e164) return res.status(400).json({ error: 'Valid phone is required' });

    // 1) Property (for SMS text)
    const { data: prop, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', property_id)
      .maybeSingle();
    if (pErr || !prop) throw new Error('Property not found');

    // 2) Cleaner upsert by phone (requires unique index on cleaners.phone)
    const { data: cleaner, error: cErr } = await supabase
      .from('cleaners')
      .upsert({ phone: e164, name }, { onConflict: 'phone' })
      .select('id')
      .single();
    if (cErr || !cleaner?.id) throw (cErr || new Error('Could not upsert cleaner'));

    // 3) Invite (idempotent)
    const inviteId = await upsertInvite({ property_id, cleaner_id: cleaner.id });

    // 4) Build invite URL
    const inviteUrl = absUrl(req, `/onboard/cleaner?id=${inviteId}`);

    // 5) Twilio send (Messaging Service preferred; fallback to single FROM)
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('Twilio credentials missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN).');

    const client = twilio(sid, token);

    const msgOpts = {
      to: e164,
      // keep short for trial accounts; Twilio adds its own trial prefix
      body: `TurnQA invite for “${prop.name || 'your property'}”: ${inviteUrl}`
    };

    // tolerant sender lookup (Messaging Service SID OR any of several FROM vars)
    const msid =
      process.env.TWILIO_MESSAGING_SERVICE_SID ||
      process.env.TWILIO_MSG_SID || null;

    const fromNumber =
      process.env.TWILIO_FROM ||
      process.env.TWILIO_FROM_NUMBER ||
      process.env.TWILIO_PHONE_NUMBER ||
      process.env.TWILIO_SMS_FROM ||
      process.env.NEXT_PUBLIC_TWILIO_FROM || '';

    if (msid) {
      msgOpts.messagingServiceSid = msid;
    } else if (fromNumber) {
      msgOpts.from = fromNumber;
    } else {
      throw new Error('Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM).');
    }

    await client.messages.create(msgOpts);

    return res.json({
      ok: true,
      invite_id: inviteId,
      cleaner_id: cleaner.id,
      sent_to: e164,
      link: inviteUrl
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message || 'invite failed',
      tip: 'On a Twilio trial, messages can only go to verified numbers and must be short.'
    });
  }
}
