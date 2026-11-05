// pages/api/cleaner/start-turn.js
import { createClient } from '@supabase/supabase-js';
import { readCleanerSession } from '@/lib/session';
import { isActiveProfile } from '@/lib/requireActiveSubscription';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { property_id, notes, action = 'check' } = req.body || {};
    if (!property_id) return res.status(400).json({ error: 'property_id is required' });
    if (!['check', 'new'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const sess = readCleanerSession(req);
    const cleaner_id = sess?.cleaner_id || sess?.sub;
    if (!cleaner_id) return res.status(401).json({ error: 'not_authenticated' });

    const { data: allowed, error: aErr } = await supabase
      .from('property_cleaners')
      .select('property_id')
      .eq('property_id', property_id)
      .eq('cleaner_id', cleaner_id)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!allowed) return res.status(403).json({ error: 'Cleaner not assigned to this property' });

    const { data: propRow, error: pErr } = await supabase
      .from('properties')
      .select('manager_id')
      .eq('id', property_id)
      .maybeSingle();
    if (pErr) throw pErr;
    const manager_id = propRow?.manager_id;
    if (!manager_id) return res.status(403).json({ error: 'Property has no assigned manager' });

    const { data: manager, error: mErr } = await supabase
      .from('managers')
      .select('user_id')
      .eq('id', manager_id)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!manager?.user_id) return res.status(403).json({ error: 'Manager account not found' });

    const { data: profile, error: sErr } = await supabase
      .from('profiles')
      .select('id, subscription_status, active_until, trial_ends_at')
      .eq('id', manager.user_id)
      .maybeSingle();
    if (sErr) throw sErr;
    if (!isActiveProfile(profile)) {
      return res.status(402).json({ error: 'The property manager subscription is inactive' });
    }

    if (action === 'check') {
      const { data: unfinished, error: eErr } = await supabase
        .from('turns')
        .select('id, created_at')
        .eq('property_id', property_id)
        .eq('cleaner_id', cleaner_id)
        .eq('status', 'in_progress')
        .order('created_at', { ascending: false })
        .limit(50);
      if (eErr) throw eErr;
      if (unfinished?.length) {
        return res.status(200).json({ ok: true, choice_required: true, unfinished });
      }
    }

    // 'new' is an explicit user choice; never silently reuse an old turn.
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .insert({
        property_id,
        cleaner_id,
        manager_id,
        notes: notes || null,
        status: 'in_progress',
      })
      .select('id')
      .single();
    if (tErr) throw tErr;
    return res.status(200).json({ ok: true, turn_id: turn.id, reused: false });
  } catch (e) {
    console.error('start-turn error', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
