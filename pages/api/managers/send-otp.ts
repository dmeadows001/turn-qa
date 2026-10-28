
import type { NextApiRequest, NextApiResponse } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'crypto';
import twilio from 'twilio';

export const config = { api: { bodyParser: true } };

const isE164 = (p: string) => /^\+[1-9]\d{6,14}$/.test(p);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Authenticate the manager through their Supabase session.
    const authClient = createPagesServerClient({ req, res });
    const { data: { user }, error: authError } =
      await authClient.auth.getUser();

    if (authError || !user) {
      return res.status(401).json({
        error: 'Please sign in before verifying your phone.',
      });
    }

    const { phone } = req.body || {};

    if (typeof phone !== 'string' || !isE164(phone)) {
      return res.status(400).json({
        error: 'Invalid phone (use E.164, e.g. +16025551234)',
      });
    }

    // Never use a user_id supplied by the browser.
    const userId = user.id;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        error: 'Supabase service environment variables missing',
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Preserve the existing 60-second cooldown.
    const { data: last, error: lastError } = await supabase
      .from('manager_phone_verifications')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastError) throw lastError;

    if (last) {
      const seconds =
        (Date.now() - new Date(last.created_at).getTime()) / 1000;

      if (seconds < 60) {
        return res.status(429).json({
          error: 'Please wait before requesting another code.',
        });
      }
    }

    // Cryptographically secure six-digit OTP.
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(
      Date.now() + 10 * 60 * 1000
    ).toISOString();

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const mss = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const from = process.env.TWILIO_FROM;

    if (process.env.DISABLE_SMS !== '1' &&
        (!sid || !token || (!mss && !from))) {
      return res.status(500).json({
        error: 'Twilio configuration missing',
      });
    }

    const { error: insertError } = await supabase
      .from('manager_phone_verifications')
      .insert({
        user_id: userId,
        phone,
        code,
        expires_at: expiresAt,
      });

    if (insertError) throw insertError;

    // Preserve the existing test-mode behavior.
    if (process.env.DISABLE_SMS === '1') {
      return res.status(200).json({
        ok: true,
        testMode: true,
      });
    }

    const client = twilio(sid!, token!);

    const body = [
      `TurnQA code: ${code}`,
      'Use within 10 minutes to verify your phone.',
      "You'll get texts when cleaners submit turns.",
      'Reply STOP to opt out, HELP for help.',
    ].join('\n');

    const payload: {
      to: string;
      body: string;
      messagingServiceSid?: string;
      from?: string;
    } = { to: phone, body };

    if (mss) {
      payload.messagingServiceSid = mss;
    } else {
      payload.from = from;
    }

    await client.messages.create(payload);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[manager send-otp] error', err);
    return res.status(500).json({
      error: 'Internal error',
    });
  }
}
