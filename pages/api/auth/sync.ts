// pages/api/auth/sync.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerClient } from '@supabase/ssr';
import { serialize } from 'cookie';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { access_token, refresh_token } = req.body || {};
    if (!access_token || !refresh_token) {
      return res.status(400).json({ error: 'access_token and refresh_token required' });
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies[name],
          set: (name: string, value: string, options: any) => {
            res.setHeader('Set-Cookie', serialize(name, value, options));
          },
          remove: (name: string, options: any) => {
            res.setHeader('Set-Cookie', serialize(name, '', { ...options, maxAge: 0 }));
          },
        },
      }
    );

    // This will set the auth cookies on the response
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) return res.status(401).json({ error: error.message });

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
