// /lib/supabaseBrowser.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SupabaseClient | undefined;
}

export const supabaseBrowser = () => {
  if (!globalThis.__supabase__) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    globalThis.__supabase__ = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'turnqa-auth', // unique key so multiple clients don't clash
      },
    });
    // Helpful once in the console so we know which URL/Key set is being used:
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.log('[supabase] init', { url, storageKey: 'turnqa-auth' });
    }
  }
  return globalThis.__supabase__!;
};
