// lib/supabaseBrowser.ts
import { createClient } from '@supabase/supabase-js';

const client =
  (typeof window !== 'undefined' && (window as any).__supabase__) ||
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

if (typeof window !== 'undefined') {
  (window as any).__supabase__ = client;
}

export const supabaseBrowser = () => client;
