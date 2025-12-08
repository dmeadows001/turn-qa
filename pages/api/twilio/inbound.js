// pages/api/twilio/inbound.js
//
// Twilio inbound webhook for STOP / START style keywords.
// - Marks numbers as opted-out (sms_opt_out_at) on STOP
// - Clears opt-out flag on START / YES / UNSTOP
//
// This does NOT affect any existing routes; it's a standalone handler.

import { supabaseAdmin } from '@/lib/supabaseAdmin';

function normalizePhone(raw = '') {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d;
  if (/^\d{10}$/.test(d)) return `+1${d}`; // simple US default
  return `+${d}`;
}

// Small helper to update both managers & cleaners tables
async function updateOptOutStatus(supabase, phone, optedOut) {
  const ts = optedOut ? new Date().toISOString() : null;

  const tables = ['managers', 'cleaners'];

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .update({ sms_opt_out_at: ts })
      .eq('phone', phone);

    // Best-effort only — don't fail the webhook if one table errors
    if (error) {
      console.error(`[twilio inbound] Failed to update ${table} for ${phone}:`, error.message);
    }
  }
}

// Next.js API config: allow Twilio's default form-encoded body
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).send('Method Not Allowed');
  }

  const supabase = supabaseAdmin();

  // Twilio sends form-encoded params like Body, From, MessageSid, etc.
  const bodyParam = (req.body?.Body || '').toString().trim();
  const fromParam = (req.body?.From || '').toString().trim();

  if (!bodyParam || !fromParam) {
    // Always respond 200 to Twilio, even if we don't recognize the payload
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  }

  const text = bodyParam.toUpperCase();
  const firstWord = text.split(/\s+/)[0] || '';
  const phone = normalizePhone(fromParam);

  try {
    // STOP family → mark opted out
    if (firstWord === 'STOP' || firstWord === 'STOPALL' || firstWord === 'CANCEL' || firstWord === 'UNSUBSCRIBE') {
      await updateOptOutStatus(supabase, phone, true);

      res.setHeader('Content-Type', 'text/xml');
      return res
        .status(200)
        .send('<Response><Message>You have been opted out of TurnQA alerts. Reply START to resubscribe.</Message></Response>');
    }

    // START / YES / UNSTOP → clear opt-out flag (user may still need to re-verify in app)
    if (firstWord === 'START' || firstWord === 'YES' || firstWord === 'UNSTOP') {
      await updateOptOutStatus(supabase, phone, false);

      res.setHeader('Content-Type', 'text/xml');
      return res
        .status(200)
        .send('<Response><Message>You have been resubscribed to TurnQA alerts.</Message></Response>');
    }

    // Any other inbound message — ignore, but respond 200 so Twilio is happy
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  } catch (err) {
    console.error('[twilio inbound] Unexpected error:', err);
    // Still respond 200; Twilio just needs an acknowledgment
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  }
}
