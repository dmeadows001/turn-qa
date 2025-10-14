// pages/api/managers/turn-submitted.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { notifyManagerForTurn } from '@/lib/notify';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---- helpers ----
function parseBody(raw: any) {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw || {};
}

// Minimal admin client just for debug mode so we can see what's happening
function adminClientForDebug(): SupabaseClient | null {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    '';
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-TurnQA-Admin-Debug': '1' } },
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // allow ?debug=1 to help diagnose env / lookup issues
  const debug = String(req.query?.debug || '') === '1';

  const b = parseBody(req.body);
  const turn_id: string | undefined = (b.turn_id || b.turnId || '').trim();
  const kind: 'initial' | 'fix' = (b.kind === 'fix' ? 'fix' : 'initial');

  if (!turn_id) return res.status(400).json({ error: 'turn_id required' });

  // ---- debug path: show whether we can see the turn with the server's env vars ----
  if (debug) {
    try {
      const supa = adminClientForDebug();
      const dbg: Record<string, any> = {
        debug: true,
        turn_id,
        supabase_url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null,
        has_service_key: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY),
        node_env: process.env.NODE_ENV,
      };

      if (!supa) {
        return res.json({ ...dbg, found: false, reason: 'no_admin_client_env', hint: 'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY' });
      }

      const { data, error } = await supa
        .from('turns')
        .select('id, property_id, cleaner_id')
        .eq('id', turn_id)
        .maybeSingle();

      return res.json({
        ...dbg,
        found: !!data,
        error,
      });
    } catch (e: any) {
      return res.json({ debug: true, turn_id, error: e?.message || String(e) });
    }
  }

  // ---- normal path: try to notify the manager ----
  const out = await notifyManagerForTurn(turn_id, kind);

  // If we didn't send, return a 409 with the reason (what you were seeing before)
  const status = out.sent ? 200 : 409;
  return res.status(status).json({ ok: !!out.sent, ...out });
}
