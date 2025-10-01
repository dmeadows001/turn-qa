// pages/api/auth.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = createServerSupabaseClient({ req, res });
  const { access_token, refresh_token } = (req.body || {}) as {
    access_token?: string;
    refresh_token?: string;
  };

  if (!access_token || !refresh_token) {
    return res.status(400).json({ error: 'Missing access_token or refresh_token' });
  }

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) return res.status(400).json({ error: error.message });

  return res.json({ ok: true });
}
