// pages/api/turns/create.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { property_id, cleaner_id, notes = '' } = req.body || {};
    if (!property_id || !cleaner_id) {
      return res.status(400).json({ error: 'property_id and cleaner_id are required' });
    }

    // create the turn
    const { data: turn, error } = await supa
      .from('turns')
      .insert({ property_id, cleaner_id, status: 'in_progress', notes })
      .select('id')
      .single();
    if (error) throw error;

    // build absolute link (always https + plural /turns/)
    const base =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_BASE_URL ||
      'https://www.turnqa.com';
    const link = `${base.replace(/\/+$/, '')}/turns/${turn.id}/capture`;

    // send SMS to cleaner
    const { default: twilio } = await import('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const body = `TurnQA: Start clean: ${link} STOP=stop`; // short for trial

    const opts = { to: req.body.cleaner_phone || '' , body }; // optional if you post the phone
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      opts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else {
      opts.from = process.env.TWILIO_FROM_NUMBER;
    }

    // If you don’t post cleaner_phone, look it up by cleaner_id:
    if (!opts.to) {
      const { data: c, error: cErr } = await supa
        .from('cleaners')
        .select('phone')
        .eq('id', cleaner_id)
        .single();
      if (cErr || !c?.phone) throw new Error('Cleaner phone not found');
      opts.to = c.phone;
    }

    const sms = await client.messages.create(opts);

    return res.status(200).json({ ok: true, turn, link, sms: { sid: sms.sid } });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
