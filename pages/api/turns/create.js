// pages/api/turns/create.js
import { createClient } from '@supabase/supabase-js';

const srv = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const anon = (authHeader) => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { global: { headers: { Authorization: authHeader || '' } } }
);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', ['POST']); return res.status(405).json({ error: 'Method not allowed' }); }

  try {
    const { property_id, cleaner_id, notes } = req.body || {};
    if (!property_id || !cleaner_id) return res.status(400).json({ error: 'property_id and cleaner_id are required' });

    // identify user
    const userClient = anon(req.headers.authorization);
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return res.status(401).json({ error: 'not_authenticated' });

    // load property -> org
    const { data: prop, error: pErr } = await srv
      .from('properties')
      .select('id, name, org_id')
      .eq('id', property_id)
      .single();
    if (pErr || !prop) return res.status(404).json({ error: 'property_not_found' });

    // authorize: owner or manager in this org
    const { data: ownerOrg } = await srv
      .from('organizations')
      .select('id')
      .eq('id', prop.org_id)
      .eq('owner_user_id', user.id)
      .limit(1);

    const { data: mgrOrg } = await srv
      .from('managers')
      .select('id')
      .eq('org_id', prop.org_id)
      .eq('user_id', user.id)
      .limit(1);

    if (!ownerOrg?.length && !mgrOrg?.length) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // ensure cleaner belongs to org & has consent
    const { data: cleaner, error: clErr } = await srv
      .from('cleaners')
      .select('id, name, phone, sms_consent')
      .eq('id', cleaner_id)
      .eq('org_id', prop.org_id)
      .single();
    if (clErr || !cleaner) return res.status(400).json({ error: 'cleaner_not_in_org' });
    if (!cleaner.sms_consent) return res.status(400).json({ error: 'cleaner_has_no_sms_consent' });

    // create the turn
    const { data: turn, error: tErr } = await srv
      .from('turns')
      .insert({
        property_id: prop.id,
        cleaner_id: cleaner.id,
        status: 'in_progress',
        notes: notes || null
      })
      .select('id')
      .single();
    if (tErr) throw tErr;

    // SMS capture link
    const base = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || '';
    const link = `${base}/turns/${turn.id}/capture`;
    const body = `TurnQA: New clean at "${prop.name}". Open to start & upload photos: ${link}. Reply STOP to opt out, HELP for help.`;

    const { default: twilio } = await import('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const opts = { to: cleaner.phone, body };
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      opts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else {
      opts.from = process.env.TWILIO_FROM_NUMBER;
    }
    const msg = await client.messages.create(opts);

    return res.status(200).json({ ok: true, turn, sms: { sid: msg.sid }, link });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
