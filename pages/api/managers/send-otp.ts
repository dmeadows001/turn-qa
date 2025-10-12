// pages/api/manager/send-otp.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // service role
);

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

const isE164 = (p: string) => /^\+?[1-9]\d{6,14}$/.test(p);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const { user_id, phone } = req.body as { user_id?: string; phone?: string };
    if (!user_id || !phone) return res.status(400).json({ error: 'user_id and phone required' });
    if (!isE164(phone)) return res.status(400).json({ error: 'Invalid phone (use E.164, e.g. +16025551234)' });

    // Rate limit: at most 1 send per 60s
    const { data: last } = await supabase
      .from('manager_phone_verifications')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (last) {
      const seconds = (Date.now() - new Date(last.created_at).getTime()) / 1000;
      if (seconds < 60) return res.status(429).json({ error: 'Please wait before requesting another code.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insErr } = await supabase.from('manager_phone_verifications').insert({
      user_id,
      phone,
      code,
      expires_at: expiresAt
    });
    if (insErr) return res.status(500).json({ error: insErr.message });

    const body = [
      `TurnQA code: ${code}`,
      `Use within 10 minutes to verify your phone.`,
      `You’ll get texts when cleaners submit turns.`,
      `Reply STOP to opt out, HELP for help.`
    ].join('\n');

    const payload: any = { to: phone, body };
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      payload.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else if (process.env.TWILIO_FROM) {
      payload.from = process.env.TWILIO_FROM;
    } else {
      return res.status(500).json({ error: 'Twilio FROM or MESSAGING_SERVICE_SID is required' });
    }

    await client.messages.create(payload);
    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('send-otp error', err);
    res.status(500).json({ error: 'Internal error' });
  }
}
