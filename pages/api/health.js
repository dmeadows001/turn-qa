// pages/api/health.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Portable health check:
 * - "Ping" the DB by selecting 0–1 rows from a table you definitely have.
 *   (properties is a good default in this app; change if needed.)
 */
export default async function handler(req, res) {
  try {
    const { error: dbErr } = await supabase
      .from('properties')
      .select('id', { head: true, count: 'exact' })
      .limit(1);

    if (dbErr) throw dbErr;

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
