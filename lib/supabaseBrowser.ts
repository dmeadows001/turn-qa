import { createClient } from '@supabase/supabase-js';

let _client: ReturnType<typeof createClient> | null = null;

/** Singleton, do not create multiple clients in the browser */
export const supabaseBrowser = () => {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        /**
         * IMPORTANT: we do our own token handling on /auth/callback.
         * If this is true, the SDK will also try to process hash params,
         * which can cause “double parse” weirdness.
         */
        detectSessionInUrl: false
      }
    }
  );
  return _client;
};
