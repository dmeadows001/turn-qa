// pages/api/ensure-profile.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabase } from '@/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  const now = new Date();
  const activeUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Upsert by user id; store email, status, trial end
  const { error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id, // assuming profiles.id = auth.users.id (UUID)
      email: user.email,
      subscription_status: 'trialing',
      active_until: activeUntil
    }, { onConflict: 'id' });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, active_until: activeUntil });
}
