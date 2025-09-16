// pages/api/otp/send.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function randCode() {
  return ('' + Math.floor(100000 + Math.random() * 900000));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow',['POST']); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const { role, subject_id, name, phone, consent } = req.body || {};
    if (!role || !['manager','cleaner'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!consent) return res.status(400).json({ error: 'consent required' });

    // If subject not created yet and role is cleaner, you could create one here. For now we just require subject_id or skip.
    let sid = subject_id;
    if (!sid) {
      const table = role === 'manager' ? 'managers' : 'cleaners';
      const { data, error } = await supabase.from(table).insert({ name: name || role, phone }).select('id').single();
      if (error) throw error;
      sid = data.id;
    } else {
      const table = role === 'manager' ? 'managers' : 'cleaners';
      await supabase.from(table).update({ phone }).eq('id', sid);
    }

    // Create OTP
    const code = randCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
    const { error: iErr } = await supabase.from('phone_otps').insert({
      role, subject_id: sid, phone, code, expires_at: expires
    });
    if (iErr) throw iErr;

    // Send via Twilio
    const { default: twilio } = await import('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const body = `TurnQA code: ${code}. Reply STOP to opt out, HELP for help.`;
    const opts = { to: phone, body };
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      opts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else {
      opts.from = process.env.TWILIO_FROM_NUMBER;
    }
    await client.messages.create(opts);

    return res.status(200).json({ ok: true, subject_id: sid });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
