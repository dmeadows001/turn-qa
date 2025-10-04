// pages/api/bootstrap.js
// Creates a trial organization for the signed-in user (if missing)
// and ensures a managers row tied to that org/user.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function srv() {
  if (!URL || !SERVICE_KEY) {
    throw new Error('Supabase server env is missing (URL or SERVICE_KEY).');
  }
  return createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
}

function userClientFromAuth(authHeader = '') {
  if (!URL || !ANON_KEY) {
    throw new Error('Supabase anon env is missing (URL or ANON_KEY).');
  }
  return createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const admin = srv();
    const userClient = userClientFromAuth(req.headers.authorization || '');

    // 1) Identify user
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return res.status(401).json({ error: 'not_authenticated' });

    // 2) Find or create org
    const { data: orgExisting, error: oErr } = await admin
      .from('organizations')
      .select('*')
      .eq('owner_user_id', user.id)
      .limit(1);
    if (oErr) throw oErr;

    let org = orgExisting?.[0];
    if (!org) {
      const trialDays = Number(process.env.TRIAL_DAYS || 15);
      const start = new Date();
      const end = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
      const name = user.email ? `${user.email.split('@')[0]}'s Org` : 'My Organization';

      const { data, error } = await admin
        .from('organizations')
        .insert({
          name,
          owner_user_id: user.id,
          trial_starts_at: start.toISOString(),
          trial_ends_at: end.toISOString(),
          plan_tier: 'trial',
          subscription_status: 'trial',
        })
        .select('*')
        .single();
      if (error) throw error;
      org = data;
    }

    // 3) Ensure a manager row linked to this org + user
    const { data: mgrs, error: mErr } = await admin
      .from('managers')
      .select('id')
      .eq('user_id', user.id)
      .eq('org_id', org.id)
      .limit(1);
    if (mErr) throw mErr;

    if (!mgrs?.length) {
      const { error: iErr } = await admin.from('managers').insert({
        user_id: user.id,
        org_id: org.id,
        name: user.email || 'Manager',
      });
      if (iErr) throw iErr;
    }

    return res.status(200).json({ ok: true, org });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
