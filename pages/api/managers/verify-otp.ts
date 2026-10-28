
import type { NextApiRequest, NextApiResponse } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';

export const config = { api: { bodyParser: true } };

const E164 = /^\+[1-9]\d{6,14}$/;

function normalizeToE164(raw: string): string | null {
  if (!raw) return null;

  const s = String(raw).trim();
  if (E164.test(s)) return s;

  const digits = s.replace(/\D/g, '');

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return null;
}

function codesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Method Not Allowed',
    });
  }

  try {
    // Authenticate the manager using their Supabase session.
    const authClient = createPagesServerClient({ req, res });

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return res.status(401).json({
        error: 'Please sign in before verifying your phone.',
      });
    }

    // Never trust a user_id supplied by the browser.
    const userId = user.id;

    const { code, consent } = req.body || {};

    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({
        error: 'Enter a valid 6-digit code.',
      });
    }

    if (consent !== true) {
      return res.status(400).json({
        error: 'SMS consent is required.',
      });
    }

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

    // Find the latest OTP for the authenticated manager only.
    const { data: row, error: rowError } = await supabase
      .from('manager_phone_verifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rowError) throw rowError;

    if (!row) {
      return res.status(400).json({
        error: 'No pending verification found.',
      });
    }

    if ((row.attempts ?? 0) >= 5) {
      return res.status(429).json({
        error: 'Too many attempts. Request a new code.',
      });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        error: 'Code expired. Request a new one.',
      });
    }

    if (!codesMatch(String(row.code), code)) {
      const { error: attemptError } = await supabase
        .from('manager_phone_verifications')
        .update({ attempts: (row.attempts ?? 0) + 1 })
        .eq('id', row.id);

      if (attemptError) throw attemptError;

      return res.status(400).json({
        error: 'Invalid code.',
      });
    }

    const phone = normalizeToE164(row.phone || '');

    if (!phone) {
      return res.status(400).json({
        error: 'Invalid phone number.',
      });
    }

    const now = new Date().toISOString();

    const consentText =
      'I agree to receive SMS alerts (STOP to opt out, HELP for help).';

    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() ||
      req.socket?.remoteAddress ||
      null;

    // Ensure the authenticated manager has a database record.
    const { data: existing, error: fetchError } = await supabase
      .from('managers')
      .select('id, name')
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!existing) {
      const displayName =
        (user.user_metadata?.full_name as string) ||
        (user.user_metadata?.name as string) ||
        user.email ||
        'Manager';

      const { error: insertError } = await supabase
        .from('managers')
        .insert({
          user_id: userId,
          name: displayName,
          phone: null,
          created_at: now,
        });

      if (insertError) throw insertError;
    }

    // Update only the authenticated manager's phone record.
    const { data: updated, error: updateError } = await supabase
      .from('managers')
      .update({
        phone,
        phone_verified_at: now,
        sms_consent: true,
        sms_consent_at: now,
        sms_consent_ip: ip,
        consent_text_snapshot: consentText,
      })
      .eq('user_id', userId)
      .select('id');

    if (updateError) throw updateError;

    if (!updated || updated.length === 0) {
      return res.status(500).json({
        error: 'Manager record could not be updated.',
      });
    }

    // Consume the OTP after successful verification.
    const { error: deleteError } = await supabase
      .from('manager_phone_verifications')
      .delete()
      .eq('id', row.id);

    if (deleteError) throw deleteError;

    return res.status(200).json({
      ok: true,
      phone,
      consent: true,
      verified_at: now,
    });
  } catch (err) {
    console.error('[manager verify-otp] error', err);

    return res.status(500).json({
      error: 'Internal error',
    });
  }
}
