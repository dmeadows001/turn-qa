// pages/api/managers/send-otp.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: true } };

const isE164 = (p: string) => /^\+?[1-9]\d{6,14}$/.test(p);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[send-otp] hit', req.method, req.url);

  // Allow preflight and provide a debug ping
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(200).json({ ok: true, method: 'OPTIONS' });
  }
  if (req.method === 'GET') {
    // No env access here — should never 500
    return res.status(200).json({ ok: true, ping: true, method: 'GET' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { user_id, phone } = req.body as { user_id?: string; phone?: string };
    if (!user_id || !phone) return res.status(400).json({ error: 'user_id and phone required' });
    if (!isE164(phone)) return res.status(400).json({ error: 'Invalid phone (use E.164, e.g. +16025551234)' });

    // Lazily create Supabase client (avoids crash if envs were missing during module load)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ error: 'Supabase service env vars missing' });
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // Rate-limit: 60s between sends for this user
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
      user_id, phone, code, expires_at: expiresAt
    });
    if (insErr) return res.status(500).json({ error: insErr.message });

    // Lazily init Twilio only now
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const from = process.env.TWILIO_FROM;

    if (!sid || !token || (!messagingServiceSid && !from)) {
      return res.status(500).json({ error: 'Twilio env vars missing (need ACCOUNT_SID, AUTH_TOKEN and FROM or MESSAGING_SERVICE_SID)' });
    }

    const client = twilio(sid, token);
    const body = [
      `TurnQA code: ${code}`,
      `Use within 10 minutes to verify your phone.`,
      `You’ll get texts when cleaners submit turns.`,
      `Reply STOP to opt out, HELP for help.`
    ].join('\n');

    const payload: any = { to: phone, body };
    if (messagingServiceSid) payload.messagingServiceSid = messagingServiceSid;
    else payload.from = from;

    await client.messages.create(payload);

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[send-otp] error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
