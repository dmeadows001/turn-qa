// pages/api/org/cleaners.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';     // service role (RLS bypass)
import { createServerSupabase } from '@/lib/supabaseServer';       // reads user from cookies

// Handle both export styles (function vs singleton)
const admin = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { property_id } = req.query || {};
    if (!property_id) return res.status(400).json({ error: 'property_id is required' });

    // 1) Identify the user from server cookies (no Authorization header games)
    const supaUser = createServerSupabase(req, res);
    const { data: { user }, error: uErr } = await supaUser.auth.getUser();
    if (uErr || !user) return res.status(401).json({ error: 'not_authenticated' });

    // 2) Load property -> org (admin client)
    const { data: prop, error: pErr } = await admin
      .from('properties')
      .select('id, org_id')
      .eq('id', property_id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!prop) return res.status(404).json({ error: 'property_not_found' });

    // 3) Authorize: owner OR manager of this org (admin client)
    const { data: ownerOrg, error: oErr } = await admin
      .from('organizations')
      .select('id')
      .eq('id', prop.org_id)
      .eq('owner_user_id', user.id)
      .limit(1);
    if (oErr) throw oErr;

    const { data: mgrOrg, error: mErr } = await admin
      .from('managers')
      .select('id')
      .eq('org_id', prop.org_id)
      .eq('user_id', user.id)
      .limit(1);
    if (mErr) throw mErr;

    if (!(ownerOrg?.length || mgrOrg?.length)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // 4) List sms-consented cleaners in this org (admin client)
    const { data: cleaners, error: cErr } = await admin
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
