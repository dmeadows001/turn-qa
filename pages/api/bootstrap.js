// pages/api/bootstrap.js
// Creates a trial org for the signed-in user (if missing)
// and ensures a managers row tied to that org/user.

import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// --- resolve admin client whether you export a factory or an instance ---
const admin = typeof _admin === 'function' ? _admin() : _admin;

function userClientFromAuth(authHeader = '') {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, {
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
    // 1) Identify user from the Bearer token the browser sends
    const userClient = userClientFromAuth(req.headers.authorization || '');
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return res.status(401).json({ error: 'not_authenticated' });

    // 2) Find (or create) org owned by this user
    let { data: org, error: oSelErr } = await admin
      .from('organizations')
      .select('id, name, trial_starts_at, trial_ends_at, plan_tier, subscription_status')
      .eq('owner_user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (oSelErr && oSelErr.code !== 'PGRST116') throw oSelErr; // ignore "no rows" style

    if (!org) {
      const trialDays = Number(process.env.TRIAL_DAYS || 30);
      const now = new Date();
      const end = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

      const name =
        (user.email && `${user.email.split('@')[0]}'s Org`) ||
        'My Organization';

      const ins = await admin
        .from('organizations')
        .insert({
          name,
          owner_user_id: user.id,
          trial_starts_at: now.toISOString(),
          trial_ends_at: end.toISOString(),
          plan_tier: 'trial',
          subscription_status: 'trial',
        })
        .select('id, name, trial_starts_at, trial_ends_at, plan_tier, subscription_status')
        .single();

      if (ins.error) throw ins.error;
      org = ins.data;
    }

    // 3) Ensure a managers row linked to this org+user (idempotent)
    const mgr = await admin
      .from('managers')
      .upsert(
        {
          user_id: user.id,
          org_id: org.id,
          name: user.email || 'Manager',
        },
        { onConflict: 'user_id,org_id', ignoreDuplicates: false }
      )
      .select('id')
      .maybeSingle();
    if (mgr.error) throw mgr.error;

    return res.status(200).json({ ok: true, org });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
