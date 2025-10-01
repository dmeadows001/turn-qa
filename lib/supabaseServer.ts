// lib/supabaseServer.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';

// Returns a server-side Supabase client *bound to the request/response cookies*.
// This lets supabase.auth.getUser() work in API routes.
export function createServerSupabase(req: NextApiRequest, res: NextApiResponse) {
  return createServerSupabaseClient({ req, res });
}
