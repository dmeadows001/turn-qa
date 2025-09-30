import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabase } from '@/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const supabase = createServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  const now = new Date();
  const activeUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Upsert profile by auth UID
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!existing) {
    await supabase.from('profiles').insert({
      id: user.id,
      email: user.email,
      subscription_status: 'trial',
      active_until: activeUntil
    });
  }

  res.json({ ok: true });
}
