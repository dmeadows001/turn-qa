// pages/api/org/cleaners.js
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
  if (req.method !== 'GET') { res.setHeader('Allow', ['GET']); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const { property_id } = req.query || {};
    if (!property_id) return res.status(400).json({ error: 'property_id is required' });

    // identify user
    const userClient = anon(req.headers.authorization);
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return res.status(401).json({ error: 'not_authenticated' });

    // load property -> org
    const { data: prop, error: pErr } = await srv
      .from('properties')
      .select('id, org_id')
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

    // list sms-consented cleaners in this org
    const { data: cleaners, error: cErr } = await srv
      .from('cleaners')
      .select('id, name, phone, sms_consent, created_at')
      .eq('org_id', prop.org_id)
      .eq('sms_consent', true)
      .order('created_at', { ascending: false });
    if (cErr) throw cErr;

    return res.status(200).json({ cleaners });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
