// pages/api/list-turns.js
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client.
 * - Uses SERVICE_ROLE if available (server-only), otherwise falls back to ANON.
 * - URL must be provided via NEXT_PUBLIC_SUPABASE_URL (standard in Next.js/Supabase setups).
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Query params: status (exact), from/to (ISO timestamps), limit (cap to 1000)
    const {
      status,
      from,
      to,
      limit: limitParam
    } = req.query;

    // Sanitize/normalize limit
    const requestedLimit = Number(limitParam ?? 200);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 1000)
      : 200;

    // Build base query against the VIEW
    // manager_turns exposes: id, created_at, submitted_at, approved_at, status, property_id, property_name, needs_fix_at
    let query = supabase
      .from('manager_turns')
      .select(
        `
        id,
        created_at,
        submitted_at,
        approved_at,
        needs_fix_at,
        status,
        property_id,
        property_name
      `
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    // Apply filters if provided
    if (status) query = query.eq('status', status);
    if (from)   query = query.gte('created_at', from);
    if (to)     query = query.lte('created_at', to);

    const { data, error } = await query;

    if (error) {
      // Surface Supabase error message for debugging (safe here; read-only endpoint)
      throw new Error(error.message || 'Query failed');
    }

    // Shape is already flat thanks to the view; just ensure defaults where useful
    const rows = (data || []).map(r => ({
      id: r.id,
      created_at: r.created_at,
      submitted_at: r.submitted_at,
      approved_at: r.approved_at,
      needs_fix_at: r.needs_fix_at,
      status: r.status,
      property_id: r.property_id,
      property_name: r.property_name || '(unnamed)'
    }));

    return res.status(200).json({ rows });
  } catch (e) {
    // Log server-side if you have logging; keep response succinct
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
