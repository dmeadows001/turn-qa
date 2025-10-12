// pages/api/managers/turn-submitted.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: true } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { turn_id } = req.body as { turn_id?: string };
    if (!turn_id) return res.status(400).json({ error: 'turn_id required' });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
    if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Supabase service env vars missing' });

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1) Gather context about the turn
    // Adjust table/column names if yours differ
    const { data: turn, error: turnErr } = await supabase
      .from('turns')
      .select(`
        id,
        created_at,
        property_id,
        score,
        notes,
        cleaner:cleaners!inner(full_name, phone),
        property:properties!inner(id, name, unit, manager_id, org_id)
      `)
      .eq('id', turn_id)
      .single();

    if (turnErr || !turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Find manager recipients (consented + verified)
    const { data: managers, error: mgrErr } = await supabase
      .from('managers')
      .select('id, name, phone, sms_consent, phone_verified_at')
      .eq('id', turn.property.manager_id)
      .eq('sms_consent', true);

    if (mgrErr) return res.status(500).json({ error: mgrErr.message });

    const recipients = (managers || [])
      .map(m => (m?.phone_verified_at && m?.phone ? String(m.phone) : null))
      .filter(Boolean) as string[];

    if (!recipients.length) {
      return res.status(200).json({ ok: true, sent: 0, reason: 'no eligible recipients' });
    }

    // 3) Build message
    const time = new Date(turn.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const propName = [turn.property?.name, turn.property?.unit].filter(Boolean).join(' · ');
    const cleanerName = turn.cleaner?.full_name || 'Cleaner';
    const score = turn.score != null ? `Score: ${turn.score}. ` : '';
    const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.turnqa.com';
    const viewUrl = `${site}/manager/turns/${turn.id}`;

    const body = [
      `Turn submitted: ${propName}`,
      `${cleanerName} at ${time}. ${score}`.trim(),
      `View: ${viewUrl}`,
      `Reply STOP to opt out, HELP for help.`
    ].join('\n');

    // 4) Optional test bypass
    if (process.env.DISABLE_SMS === '1') {
      return res.status(200).json({ ok: true, testMode: true, to: recipients, message: body });
    }

    // 5) Send via Twilio
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const mss   = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const from  = process.env.TWILIO_FROM;
    if (!sid || !token || (!mss && !from)) {
      return res.status(500).json({ error: 'Twilio env vars missing (ACCOUNT_SID, AUTH_TOKEN, and FROM or MESSAGING_SERVICE_SID)' });
    }
    const client = twilio(sid, token);

    // De-dupe numbers just in case
    const unique = [...new Set(recipients)];
    await Promise.all(unique.map(to => client.messages.create(mss ? { to, body, messagingServiceSid: mss } : { to, body, from })));

    return res.status(200).json({ ok: true, sent: unique.length });
  } catch (err: any) {
    console.error('[turn-submitted] error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
