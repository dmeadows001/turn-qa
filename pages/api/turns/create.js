// pages/api/turns/create.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { property_id, cleaner_id, notes = '', cleaner_phone = '' } = req.body || {};
    if (!property_id || !cleaner_id) {
      return res.status(400).json({ error: 'property_id and cleaner_id are required' });
    }

    // 1) Create the turn (tolerant if your schema doesn't have a `notes` column)
    let turnRow = null;

    // Attempt with `notes`
    let ins = await supa
      .from('turns')
      .insert({ property_id, cleaner_id, status: 'in_progress', notes })
      .select('id')
      .maybeSingle();

    if (ins.error) {
      const msg = (ins.error.message || '').toLowerCase();
      const looksLikeMissingNotes =
        msg.includes('column') && msg.includes('notes') && (msg.includes('does not exist') || msg.includes('unknown'));

      if (!looksLikeMissingNotes) throw ins.error;

      // Retry without `notes`
      ins = await supa
        .from('turns')
        .insert({ property_id, cleaner_id, status: 'in_progress' })
        .select('id')
        .maybeSingle();

      if (ins.error) throw ins.error;
    }

    turnRow = ins.data;
    if (!turnRow?.id) throw new Error('Could not create turn');

    // 2) Build absolute capture link (always plural /turns/)
    const base = (process.env.NEXT_PUBLIC_BASE_URL ||
                  process.env.APP_BASE_URL ||
                  process.env.NEXT_PUBLIC_APP_BASE_URL ||
                  'https://www.turnqa.com').replace(/\/+$/, '');
    const link = `${base}/turns/${turnRow.id}/capture`;

    // 3) Send SMS to cleaner (optional but typical)
    const { default: twilio } = await import('twilio');

    const to = cleaner_phone || (await lookupCleanerPhone(cleaner_id));
    if (!to) throw new Error('Cleaner phone not found');

    const body = `TurnQA: Start clean: ${link} STOP=stop`;

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const smsOpts = { to, body };

    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      smsOpts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else if (process.env.TWILIO_FROM_NUMBER) {
      smsOpts.from = process.env.TWILIO_FROM_NUMBER;
    } else {
      // Don’t hard fail the whole request—return the link even if SMS config is missing
      return res.status(200).json({ ok: true, turn: turnRow, link, sms: 'skipped (no FROM or MESSAGING_SERVICE_SID)' });
    }

    const sms = await client.messages.create(smsOpts);

    return res.status(200).json({ ok: true, turn: turnRow, link, sms: { sid: sms.sid } });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}

async function lookupCleanerPhone(cleaner_id) {
  const { data, error } = await supa
    .from('cleaners')
    .select('phone')
    .eq('id', cleaner_id)
    .maybeSingle();
  if (error) throw error;
  return data?.phone || '';
}
