// lib/supabaseServer.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';

// Returns a server-side Supabase client bound to req/res cookies.
// (If cookies are not present, auth.getUser() will not resolve a user.)
export function createServerSupabase(req: NextApiRequest, res: NextApiResponse) {
  return createPagesServerClient({ req, res });
}
