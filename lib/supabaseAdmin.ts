// lib/supabaseAdmin.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  // eslint-disable-next-line no-var
  var __supabaseAdmin: SupabaseClient | undefined;
}

let _admin: SupabaseClient | undefined;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  if (globalThis.__supabaseAdmin) return (_admin = globalThis.__supabaseAdmin);

  // Accept either URL env
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  // Accept either service key name
  const serviceKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    console.error('[supabaseAdmin] Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL');
    throw new Error('Supabase URL not configured');
  }

  if (!serviceKey) {
    if (process.env.NODE_ENV === 'development') {
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!anon) {
        console.error('[supabaseAdmin] Missing service and anon keys (dev)');
        throw new Error('Supabase keys not configured');
      }
      console.warn('[supabaseAdmin] Using ANON key (dev only).');
      _admin = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { 'X-TurnQA-Admin': '1' } },
      });
    } else {
      console.error('[supabaseAdmin] Missing SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY (prod)');
      throw new Error('Service role key not configured');
    }
  } else {
    _admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'X-TurnQA-Admin': '1' } },
    });
  }

  globalThis.__supabaseAdmin = _admin;
  return _admin!;
}

export default supabaseAdmin;
