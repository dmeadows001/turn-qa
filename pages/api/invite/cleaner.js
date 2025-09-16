// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';

const srv = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function ensureE164(s) {
  return s?.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', ['POST']); return res.status(405).json({ error: 'Method not allowed' }); }

  try {
    const { property_id, cleaner_name, cleaner_phone } = req.body || {};
    if (!property_id || !cleaner_phone) return res.status(400).json({ error: 'property_id and cleaner_phone are required' });

    const phone = ensureE164(cleaner_phone);
    // 1) Load property (need org_id + name)
    const { data: prop, error: pErr } = await srv
      .from('properties')
      .select('id, name, org_id')
      .eq('id', property_id)
      .single();
    if (pErr || !prop) return res.status(404).json({ error: 'Property not found' });

    // 2) Upsert cleaner (by phone within org)
    const { data: existing } = await srv
      .from('cleaners')
      .select('id')
      .eq('org_id', prop.org_id)
      .eq('phone', phone)
      .limit(1);
    let cleanerId = existing?.[0]?.id;
    if (!cleanerId) {
      const { data: ins, error: iErr } = await srv
        .from('cleaners')
        .insert({ org_id: prop.org_id, name: cleaner_name || 'Cleaner', phone })
        .select('id')
        .single();
      if (iErr) throw iErr;
      cleanerId = ins.id;
    } else if (cleaner_name) {
      await srv.from('cleaners').update({ name: cleaner_name }).eq('id', cleanerId);
    }

    // 3) Build onboarding link
    const base = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || '';
    const link = `${base}/onboard/cleaner?id=${cleanerId}`;

    // 4) Send SMS
    const { default: twilio } = await import('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const body = `TurnQA: You’ve been invited to clean at "${prop.name}". Open to verify your phone & get job alerts: ${link}. Reply STOP to opt out, HELP for help.`;

    const opts = { to: phone, body };
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      opts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else {
      opts.from = process.env.TWILIO_FROM_NUMBER;
    }

    const msg = await client.messages.create(opts);

    return res.status(200).json({ ok: true, link, sms: { sid: msg.sid } });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
