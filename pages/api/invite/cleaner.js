// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function normalizePhone(s = '') {
  const d = (s || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  return d.startsWith('+') ? d : `+${d}`;
}

function absUrl(req, path = '/') {
  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  const host  = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const p     = path.startsWith('/') ? path : `/${path}`;
  return `${proto}://${host}${p}`;
}

// Try an upsert; if it fails because a column or conflict target doesn't exist,
// run progressively simpler fallbacks so this works across slightly different schemas.
async function upsertInviteTolerant({ property_id, cleaner_id, phone }) {
  // 1) Preferred: has "phone" column + unique (property_id, phone)
  try {
    const { data, error } = await supabase
      .from('cleaner_invites')
      .upsert(
        { property_id, cleaner_id, phone },
        { onConflict: 'property_id,phone' }
      )
      .select('id')
      .single();
    if (!error && data) return data.id;
    if (error) throw error;
  } catch (e) {
    // fall through
  }

  // 2) Alternate: no phone column or no unique target, use (property_id, cleaner_id)
  try {
    const { data, error } = await supabase
      .from('cleaner_invites')
      .upsert(
        { property_id, cleaner_id }, // no phone here
        { onConflict: 'property_id,cleaner_id' }
      )
      .select('id')
      .single();
    if (!error && data) return data.id;
    if (error) throw error;
  } catch (e) {
    // fall through
  }

  // 3) Last resort: plain insert; if duplicate, select existing
  try {
    const { data: ins, error: insErr } = await supabase
      .from('cleaner_invites')
      .insert({ property_id, cleaner_id })
      .select('id')
      .single();

    if (!insErr && ins) return ins.id;

    // If duplicate key, try to find the existing row using either shape
    if (insErr && /duplicate key value|23505/i.test(insErr.message || '')) {
      // try (property_id, phone)
      if (phone) {
        const { data: ex1 } = await supabase
          .from('cleaner_invites')
          .select('id')
          .eq('property_id', property_id)
          .eq('phone', phone)
          .maybeSingle();
        if (ex1?.id) return ex1.id;
      }
      // try (property_id, cleaner_id)
      const { data: ex2 } = await supabase
        .from('cleaner_invites')
        .select('id')
        .eq('property_id', property_id)
        .eq('cleaner_id', cleaner_id)
        .maybeSingle();
      if (ex2?.id) return ex2.id;
    }

    throw insErr || new Error('Could not insert invite');
  } catch (e) {
    throw e;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { property_id, phone, name = '' } = req.body || {};
    const e164 = normalizePhone(phone);

    if (!property_id) return res.status(400).json({ error: 'property_id is required' });
    if (!e164)        return res.status(400).json({ error: 'Valid phone is required' });

    // 1) Load property
    const { data: prop, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', property_id)
      .single();
    if (pErr || !prop) throw new Error('Property not found');

    // 2) Upsert cleaner by phone (name is optional; ignored if your table lacks it)
    const { data: cleaner, error: cErr } = await supabase
      .from('cleaners')
      .upsert({ phone: e164, name }, { onConflict: 'phone' })
      .select('id')
      .single();
    if (cErr || !cleaner?.id) throw (cErr || new Error('Could not upsert cleaner'));

    // 3) Create/fetch invite row (tolerant to schema differences)
    const inviteId = await upsertInviteTolerant({
      property_id,
      cleaner_id: cleaner.id,
      phone: e164
    });

    const inviteUrl = absUrl(req, `/onboard/cleaner?id=${inviteId}`);

    // 4) Send SMS via Twilio
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('Twilio credentials missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN).');

    const client = twilio(sid, token);

    const msgOpts = {
      to: e164,
      // Keep short for trial accounts (Twilio adds its own “Sent from…” prefix)
      body: `TurnQA invite for “${prop.name}”: ${inviteUrl}`
    };

    const msid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const from = process.env.TWILIO_FROM || process.env.TWILIO_SMS_FROM || '';

    if (msid) msgOpts.messagingServiceSid = msid;
    else if (from) msgOpts.from = from;
    else throw new Error('Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM).');

    await client.messages.create(msgOpts);

    res.json({ ok: true, invite_id: inviteId, link: inviteUrl, sent_to: e164 });
  } catch (e) {
    res.status(500).json({
      error: e.message || 'invite failed',
      tip: 'On a Twilio trial, messages can only go to verified numbers and must be short.'
    });
  }
}
