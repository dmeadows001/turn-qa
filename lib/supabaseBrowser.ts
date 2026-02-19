// lib/supabaseBrowser.ts
import { createPagesBrowserClient } from '@supabase/auth-helpers-nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function supabaseBrowser() {
  if (_client) return _client;
  _client = createPagesBrowserClient();
  return _client;
}
