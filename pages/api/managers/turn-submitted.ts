// pages/api/managers/turn-submitted.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';
// at top with other imports
import type { MessageListInstanceCreateOptions } from 'twilio/lib/rest/api/v2010/account/message';


export const config = { api: { bodyParser: true } };

type ManagerRow = {
  id: string;
  name?: string | null;
  phone_e164?: string | null; // e.g. +18775551212
  sms_consent?: boolean | null;
};

type PropertyRow = {
  id: string;
  name?: string | null;
  manager_id?: string | null;
};

type TurnBase = {
  id: string;
  property_id: string;
  submitted_at?: string | null;
};

type TurnFromView = TurnBase & {
  // Optional/extra fields that might exist on a view:
  score?: number | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { turn_id } = (req.body || {}) as { turn_id?: string };
  if (!turn_id) return res.status(400).json({ error: 'turn_id required' });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase service role env vars missing' });
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const msgServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const fromNumber = process.env.TWILIO_FROM;

  if (!twilioSid || !twilioAuth || (!msgServiceSid && !fromNumber)) {
    return res.status(500).json({ error: 'Twilio env vars missing (ACCOUNT_SID/AUTH_TOKEN and MESSAGING_SERVICE_SID or FROM)' });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const client = twilio(twilioSid, twilioAuth);

  try {
    // 1) Try to pull the turn from a view FIRST (so we can include score if it exists).
    let turn: TurnFromView | null = null;

    // Attempt turns_view with nested property
    {
      const { data, error } = await supabase
        .from('turns_view') // may or may not exist in some setups
        .select('id, property_id, submitted_at, score')
        .eq('id', turn_id)
        .maybeSingle();

      if (error) {
        // If it's a 42P01-ish error (relation not found) or any error, we’ll fall back to the base table.
        // PostgREST wraps errors differently; either way we’ll just try the base table next.
      } else if (data) {
        turn = data as TurnFromView;
      }
    }

    // Fallback: base table
    if (!turn) {
      const { data, error } = await supabase
        .from('turns')
        .select('id, property_id, submitted_at')
        .eq('id', turn_id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: 'Error fetching turn from base table', details: error.message });
      }
      if (!data) return res.status(404).json({ error: 'Turn not found' });
      turn = data as TurnFromView;
    }

    // 2) Fetch property -> manager
    const { data: property, error: propErr } = await supabase
      .from('properties')
      .select('id, name, manager_id')
      .eq('id', turn.property_id)
      .maybeSingle();

    if (propErr) {
      return res.status(500).json({ error: 'Error fetching property', details: propErr.message });
    }
    if (!property) return res.status(404).json({ error: 'Property not found for turn' });

    if (!property.manager_id) {
      // Your schema says properties.manager_id exists; if null, we can’t notify anyone.
      return res.status(409).json({ error: 'Property has no manager_id; cannot send SMS' });
    }

    // IMPORTANT: earlier you saw "public.property_managers" not found;
    // most setups use a single "managers" table. Adjust the name if yours differs.
    const { data: manager, error: mgrErr } = await supabase
      .from('managers')
      .select('id, name, phone_e164, sms_consent')
      .eq('id', property.manager_id)
      .maybeSingle();

    if (mgrErr) {
      return res.status(500).json({ error: 'Error fetching manager', details: mgrErr.message });
    }
    if (!manager) return res.status(404).json({ error: 'Manager not found for property.manager_id' });

    if (!manager.phone_e164) {
      return res.status(409).json({ error: 'Manager has no phone number on file (phone_e164)' });
    }
    if (manager.sms_consent === false) {
      // Don’t send if they opted out.
      return res.status(200).json({ ok: true, message: 'Manager has not consented to SMS; skipping send.' });
    }

    // 3) Build the SMS body (score is optional)
    const propName = (property as PropertyRow).name || 'Your property';
    const shortId = turn.id.slice(0, 8);
    const scorePart = typeof turn.score === 'number' ? ` — score: ${turn.score}` : '';
    const reviewUrl = `https://turnqa.com/turns/${turn.id}/review?manager=1`;

    const body = `Turn ${shortId} submitted for ${propName}${scorePart}. Review: ${reviewUrl}`;

    // 4) Send the SMS
    const msgPayload: MessageListInstanceCreateOptions = {
      to: manager.phone_e164!,
      body,
    };
    if (msgServiceSid) {
      msgPayload.messagingServiceSid = msgServiceSid;
    } else if (fromNumber) {
      msgPayload.from = fromNumber;
    }

    const twResp = await client.messages.create(msgPayload);

    return res.status(200).json({
      ok: true,
      sid: twResp.sid,
      to: manager.phone_e164,
      used: msgServiceSid ? 'MESSAGING_SERVICE_SID' : 'FROM',
      preview: body,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Unhandled error in turn-submitted API', details: err?.message || String(err) });
  }
}
