// pages/api/get-turn.js
import { createClient } from '@supabase/supabase-js';

function getAccessToken(req) {
  // Preferred: Authorization: Bearer <token>
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];

  // Fallback: some setups pass token in cookie "sb-access-token"
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);

  return null;
}

function authedSupabase(req) {
  const token = getAccessToken(req);
  if (!token) return { supabase: null, token: null };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  return { supabase, token };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const id = req.query.id || req.query.turnId;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { supabase } = authedSupabase(req);
    if (!supabase) return res.status(401).json({ error: 'Not authenticated' });

    // RLS ENFORCED HERE
    const { data: turn, error } = await supabase
      .from('turns')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    // If user isn't authorized, RLS returns null (not an error) -> treat as 404.
    if (error) return res.status(500).json({ error: error.message });
    if (!turn) return res.status(404).json({ error: 'Not found' });

    return res.status(200).json({ turn });
  } catch (e) {
    console.error('[get-turn] fatal', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
