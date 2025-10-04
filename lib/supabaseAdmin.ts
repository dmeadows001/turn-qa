// lib/supabaseAdmin.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
// If you generated types (optional):
// import type { Database } from '@/types/supabase';

declare global {
  // Allows caching in dev/hot-reload without TS complaints
  // eslint-disable-next-line no-var
  var __supabaseAdmin: SupabaseClient /* <Database> */ | undefined;
}

let _admin: SupabaseClient /* <Database> */ | undefined;

export function supabaseAdmin(): SupabaseClient /* <Database> */ {
  if (_admin) return _admin;
  if (globalThis.__supabaseAdmin) return ( _admin = globalThis.__supabaseAdmin );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Prefer the service key; optionally fall back to anon during local dev.
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  _admin = createClient(/* <Database> */ url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // cache for dev/hot-reload
  globalThis.__supabaseAdmin = _admin;
  return _admin;
}
