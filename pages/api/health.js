import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  try {
    const { data, error } = await supabase.rpc('now'); // cheap ping
    if (error) throw error;
    res.json({
      ok: true,
      db_ok: true,
      env: {
        site: process.env.NEXT_PUBLIC_SITE_URL || null,
        has_service_role: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        has_anon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
