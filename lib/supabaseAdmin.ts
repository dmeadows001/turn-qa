// lib/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client for server-only code (webhooks, CRON, admin jobs).
 * Never expose the SERVICE_ROLE key to the browser.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,        // e.g. https://xxxx.supabase.co
  process.env.SUPABASE_SERVICE_ROLE_KEY!        // add this in Vercel env
);
