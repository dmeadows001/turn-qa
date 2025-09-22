// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';

// --- Twilio (optional; we'll no-op if not configured) ---
function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  // lazy import to avoid bundling if unused
  // eslint-disable-next-line global-require
  const twilio = require('twilio');
  return twilio(sid, token);
}

// Normalize to a simple E.164-ish form (very light check)
function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) return '+' + digits.replace(/^+/,'');
  return digits;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  // use service role if available so we can insert regardless of RLS on this secure API
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { property_id, cleaner_name, phone } = req.body || {};
    if (!property_id) return res.status(400).json({ error: 'property_id is required' });
    if (!cleaner_name || !cleaner_name.trim()) return res.status(400).json({ error: 'cleaner_name is required' });
    if (!phone || !phone.trim()) return res.status(400).json({ error: 'phone is required' });

    const phoneE164 = normalizePhone(phone);

    // 1) Load property (robust)
    const { data: property, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', property_id)
      .maybeSingle(); // <- tolerant to 0/1
    if (pErr) throw pErr;
    if (!property) {
      return res.status(400).json({ error: 'Property not found. Create it first, then invite.' });
    }

    // 2) Ensure a default template exists (the invite link doesn’t strictly need it,
    //    but many flows assume one. We’ll create one if none exists.)
    let { data: template, error: tErr } = await supabase
      .from('property_templates')
      .select('id, property_id, name, created_at')
      .eq('property_id', property_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (tErr) throw tErr;

    if (!template) {
      const { data: created, error: cErr } = await supabase
        .from('property_templates')
        .insert({ property_id, name: 'Default' })
        .select('id, property_id, name')
        .maybeSingle();
      if (cErr) throw cErr;
      template = created || null;
    }

    // 3) Upsert the cleaner by phone (avoid duplicates)
    //    If your schema requires property linkage, add property_id to the upsert.
    const { data: cleaner, error: upErr } = await supabase
      .from('cleaners')
      .upsert(
        {
          name: cleaner_name.trim(),
          phone: phoneE164,
          // if you have these columns:
          // property_id,
          // sms_consent: false,
        },
        { onConflict: 'phone' } // assumes 'phone' is unique, adjust if different
      )
      .select('id, name, phone')
      .maybeSingle();
    if (upErr) throw upErr;
    if (!cleaner) {
      return res.status(500).json({ error: 'Could not create or find cleaner' });
    }

    // 4) Build onboarding link (we’ll use cleaner.id directly)
    const origin =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const inviteUrl = `${origin}/onboard/cleaner?id=${encodeURIComponent(cleaner.id)}`;

    // 5) Send SMS via Twilio (if configured), otherwise no-op
    let sms = 'skipped_no_twilio';
    const tw = getTwilio();
    if (tw) {
      const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      const fromNumber = process.env.TWILIO_FROM_NUMBER;

      // Keep it short (esp. for Twilio trial)
      const body = `TurnQA: ${property.name || 'Your property'} invite link: ${inviteUrl}`;

      const msgOpts = messagingServiceSid
        ? { to: phoneE164, body, messagingServiceSid }
        : { to: phoneE164, body, from: fromNumber };

      const sent = await tw.messages.create(msgOpts);
      sms = sent?.sid ? 'sent' : 'not_sent';
    }

    return res.json({
      ok: true,
      property: { id: property.id, name: property.name },
      template_id: template?.id || null,
      cleaner_id: cleaner.id,
      inviteUrl,
      sms
    });
  } catch (e) {
    // Turn the common “single()” issue into a friendly message
    const msg = String(e?.message || e);
    if (/JSON object requested, multiple \(or no\) rows returned/i.test(msg)) {
      return res.status(400).json({
        error:
          'A required lookup returned zero or multiple rows. Likely causes: no template for this property yet, or duplicate templates. I tried to auto-create a default template; please retry.',
        detail: msg
      });
    }
    return res.status(500).json({ error: msg });
  }
}
