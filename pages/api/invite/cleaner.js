// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function absUrl(req, path = '/') {
  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  const host  = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const p     = path.startsWith('/') ? path : `/${path}`;
  return `${proto}://${host}${p}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { property_id, phone, name = '' } = req.body || {};
    const e164 = normalizePhone(phone);

    if (!property_id) return res.status(400).json({ error: 'property_id is required' });
    if (!e164)        return res.status(400).json({ error: 'Valid phone is required' });

    // 1) Property
    const { data: prop, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', property_id)
      .single();
    if (pErr || !prop) throw new Error('Property not found');

    // 2) Cleaner — upsert by phone (ok if your cleaners table ignores name)
    const { data: cleanerRow, error: cErr } = await supabase
      .from('cleaners')
      .upsert({ phone: e164, name }, { onConflict: 'phone' })
      .select('id')
      .single();
    if (cErr) throw cErr;

    // 3) Invite — NO 'name' column here; be tolerant if unique index is missing
    let inviteId;

    const { data: inv, error: iErr } = await supabase
      .from('cleaner_invites')
      .upsert(
        { property_id, cleaner_id: cleanerRow.id, phone: e164 },
        { onConflict: 'property_id,phone' }
      )
      .select('id')
      .single();

    if (!iErr && inv) {
      inviteId = inv.id;
    } else {
      // Fallback path (e.g. unique index not present yet)
      if (iErr && (iErr.code === '42704' || /schema|column|constraint/i.test(iErr.message || ''))) {
        const { data: ins, error: insErr } = await supabase
          .from('cleaner_invites')
          .insert({ property_id, cleaner_id: cleanerRow.id, phone: e164 })
          .select('id')
          .single();

        if (!insErr && ins) {
          inviteId = ins.id;
        } else if (insErr && (insErr.code === '23505' || /duplicate key value/i.test(insErr.message || ''))) {
          const { data: existing, error: selErr } = await supabase
            .from('cleaner_invites')
            .select('id')
            .eq('property_id', property_id)
            .eq('phone', e164)
            .maybeSingle();
          if (selErr || !existing) throw insErr;
          inviteId = existing.id;
        } else {
          throw insErr || iErr;
        }
      } else {
        throw iErr;
      }
    }

    const inviteUrl = absUrl(req, `/onboard/cleaner?id=${inviteId}`);

    // 4) Twilio send (Messaging Service or single number)
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('Twilio credentials missing (set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN).');

    const client = twilio(sid, token);

    const msgOpts = {
      to: e164,
      // Keep short for trial accounts (Twilio adds its own prefix)
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
