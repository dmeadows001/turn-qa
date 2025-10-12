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
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ error: 'Supabase service env vars missing' });
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1) Fetch the turn (basic fields only)
    const { data: turn, error: turnErr } = await supabase
      .from('turns')
      .select('id, created_at, property_id, score, notes, cleaner_id')
      .eq('id', turn_id)
      .single();

    if (turnErr || !turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Fetch the property (to get manager_id + display info)
    const { data: property, error: propErr } = await supabase
      .from('properties')
      .select('id, name, unit, manager_id, org_id')
      .eq('id', turn.property_id)
      .single();

    if (propErr || !property) return res.status(404).json({ error: 'Property not found' });

    // 3) (Optional) Fetch cleaner for display name (best-effort)
    let cleanerName = 'Cleaner';
    if (turn.cleaner_id) {
      const { data: cleaner } = await supabase
        .from('cleaners')
        .select('full_name')
        .eq('id', turn.cleaner_id)
        .maybeSingle();
      if (cleaner?.full_name) cleanerName = cleaner.full_name;
    }

    // 4) Pick recipients — property manager only (change to org-wide if desired)
    const { data: managers, error: mgrErr } = await supabase
      .from('managers')
      .select('id, name, phone, sms_consent, phone_verified_at')
      .eq('id', property.manager_id)
      .eq('sms_consent', true);

    if (mgrErr) return res.status(500).json({ error: mgrErr.message });

    const recipients = (managers || [])
      .map((m) => (m?.phone_verified_at && m?.phone ? String(m.phone) : null))
      .filter(Boolean) as string[];

    if (!recipients.length) {
      return res.status(200).json({ ok: true, sent: 0, reason: 'no eligible recipients' });
    }

    // 5) Build message text
    const time = new Date(turn.created_at).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    const propName = [property?.name, property?.unit].filter(Boolean).join(' · ');
    const scorePart = turn.score != null ? `Score: ${turn.score}. ` : '';
    const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.turnqa.com';
    const viewUrl = `${site}/manager/turns/${turn.id}`;

    const body = [
      `Turn submitted: ${propName}`,
      `${cleanerName} at ${time}. ${scorePart}`.trim(),
      `View: ${viewUrl}`,
      `Reply STOP to opt out, HELP for help.`,
    ].join('\n');

    // 6) Optional test bypass (no real SMS)
    if (process.env.DISABLE_SMS === '1') {
      return res.status(200).json({ ok: true, testMode: true, to: recipients, message: body });
    }

    // 7) Send via Twilio
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const mss = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || (!mss && !from)) {
      return res
        .status(500)
        .json({ error: 'Twilio env vars missing (ACCOUNT_SID, AUTH_TOKEN, and FROM or MESSAGING_SERVICE_SID)' });
    }
    const client = twilio(sid, token);

    const unique = [...new Set(recipients)];
    await Promise.all(
      unique.map((to) =>
        client.messages.create(mss ? { to, body, messagingServiceSid: mss } : { to, body, from })
      )
    );

    return res.status(200).json({ ok: true, sent: unique.length });
  } catch (err: any) {
    console.error('[turn-submitted] error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
