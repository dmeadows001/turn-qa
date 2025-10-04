// pages/api/sms/otp-send.js
import twilio from 'twilio';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Reuse your admin client (handles RLS with service role)
const supabase = typeof _admin === 'function' ? _admin() : _admin;

// ---------- helpers ----------
function toE164(raw = '') {
  const only = String(raw || '').replace(/[^\d+]/g, '');
  if (!only) return '';
  // If it already starts with +, assume E.164-ish
  if (only.startsWith('+')) return only;
  // Naive US default; adjust if you have international numbers at onboarding
  if (/^\d{10}$/.test(only)) return `+1${only}`;
  // As a last resort, add "+"
  return `+${only}`;
}

function pickSender() {
  const msid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  // Support common FROM env names
  const fromRaw =
    (process.env.TWILIO_FROM || '').trim() ||
    (process.env.TWILIO_FROM_NUMBER || '').trim() ||
    (process.env.TWILIO_PHONE_NUMBER || '').trim() ||
    (process.env.TWILIO_TOLL_FREE || '').trim() ||
    (process.env.TWILIO_TF_FROM || '').trim();

  if (msid) return { type: 'ms', msid };
  if (fromRaw) {
    // If it’s already an MG… SID, pass as-is; otherwise normalize to E.164
    const from = fromRaw.startsWith('MG') ? fromRaw : toE164(fromRaw);
    return { type: 'from', from };
  }
  return { type: 'none' };
}

function twilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !tok) return null;
  return twilio(sid, tok);
}

const mask = (s) =>
  !s
    ? s
    : s.startsWith('MG')
    ? s.slice(0, 2) + '••••' + s.slice(-4)
    : s.startsWith('+')
    ? s.slice(0, 3) + '•••' + s.slice(-2)
    : '••••';

// ---------- handler ----------
export default async function handler(req, res) {
  // Optional debug probe (GET /api/sms/otp-send?debug=1)
  if (req.method === 'GET' && 'debug' in req.query) {
    const sender = pickSender();
    return res.json({
      hasSid: !!(process.env.TWILIO_ACCOUNT_SID || '').trim(),
      hasTok: !!(process.env.TWILIO_AUTH_TOKEN || '').trim(),
      senderType: sender.type,
      from: sender.from ? mask(sender.from) : null,
      msid: sender.msid ? mask(sender.msid) : null,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const client = twilioClient();
    const sender = pickSender();
    if (!client || sender.type === 'none') {
      return res.status(500).json({
        error:
          'Twilio sender not configured. Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM / TWILIO_FROM_NUMBER.',
      });
    }

    // Accept { phone } or resolve via invite_id / cleaner_id
    const { phone, to, invite_id, cleaner_id } = req.body || {};
    let dest = phone || to || '';

    if (!dest && invite_id) {
      const { data } = await supabase
        .from('cleaner_invites')
        .select('phone')
        .eq('id', invite_id)
        .maybeSingle();
      dest = data?.phone || '';
    }

    if (!dest && cleaner_id) {
      const { data } = await supabase
        .from('cleaners')
        .select('phone')
        .eq('id', cleaner_id)
        .maybeSingle();
      dest = data?.phone || '';
    }

    if (!dest) return res.status(400).json({ error: 'No destination phone.' });

    const e = toE164(dest);
    if (!/^\+\d{8,15}$/.test(e)) return res.status(400).json({ error: 'Invalid phone format.' });

    // Generate 6-digit code; 10-minute expiry
    const code = String(Math.floor(100000 + Math.random() * 900000)).slice(0, 6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Store OTP using the SAME table your verify endpoint expects (`phone_otps`)
    // Columns assumed: phone (PK or unique), code, role, subject_id, expires_at, used_at
    // We clear used_at on send so a fresh code is valid.
    const { error: upErr } = await supabase
      .from('phone_otps')
      .upsert(
        { phone: e, code, role: 'cleaner', subject_id: cleaner_id || null, expires_at: expiresAt, used_at: null },
        { onConflict: 'phone' }
      );
    if (upErr) throw upErr;

    const body = `TurnQA code: ${code}. Reply STOP to opt out, HELP for help.`;

    const payload =
      sender.type === 'ms'
        ? { to: e, body, messagingServiceSid: sender.msid }
        : { to: e, body, from: sender.from };

    await client.messages.create(payload);

    return res.json({ ok: true, to: e, via: sender.type });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
