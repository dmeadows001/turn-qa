// pages/api/debug/service-check.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
const supa = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  try {
    // Count rows in turn_photos (RLS would normally hide these).
    const { error, count } = await supa
      .from('turn_photos')
      .select('id', { count: 'exact', head: true });

    return res.status(200).json({
      ok: !error,
      count,
      error: error?.message || null,
      hasUrl: !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL),
      hasSrvKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
