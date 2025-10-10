// lib/supabaseAdmin.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
// import type { Database } from '@/types/supabase';

declare global {
  // eslint-disable-next-line no-var
  var __supabaseAdmin: SupabaseClient /*<Database>*/ | undefined;
}

let _admin: SupabaseClient /*<Database>*/ | undefined;

export function supabaseAdmin(): SupabaseClient /*<Database>*/ {
  if (_admin) return _admin;
  if (globalThis.__supabaseAdmin) return (_admin = globalThis.__supabaseAdmin);

  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    console.error('[supabaseAdmin] Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL');
    throw new Error('Supabase URL not configured');
  }

  let keyToUse = serviceKey;

  if (!serviceKey) {
    if (process.env.NODE_ENV === 'development') {
      // local-only fallback so you can still poke around with anon key
      keyToUse = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      console.warn(
        '[supabaseAdmin] WARNING: using ANON key because SUPABASE_SERVICE_ROLE_KEY is missing (dev only).'
      );
    } else {
      console.error('[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY is missing (production)');
      throw new Error('Service role key not configured');
    }
  }

  _admin = createClient(/*<Database>*/ url, keyToUse!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { 'X-TurnQA-Admin': '1' } },
  });

  globalThis.__supabaseAdmin = _admin;
  return _admin;
}

export default supabaseAdmin;
