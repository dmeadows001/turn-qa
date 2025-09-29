// lib/supabaseServer.ts
import { createClient } from '@supabase/supabase-js';

export function createServerSupabase() {
  // Simple server-side client; good enough for API routes.
  // (We can switch to SSR cookies later if needed.)
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
