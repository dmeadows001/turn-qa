// pages/api/managers/turn-submitted.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { notifyManagerForTurn } from '@/lib/notify';

function supaAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-TurnQA-Admin': '1' } },
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const debug = req.query.debug === '1' || req.query.debug === 'true';
  const { turn_id, kind } = (req.body || {}) as { turn_id?: string; kind?: 'initial' | 'fix' };
  if (!turn_id) return res.status(400).json({ error: 'turn_id required' });

  // quick existence check for clearer errors
  const supa = supaAdmin();
  const { data: turn, error: tErr } = await supa
    .from('turns')
    .select('id')
    .eq('id', turn_id)
    .maybeSingle();

  if (!turn) {
    return res.status(409).json({
      ok: false,
      reason: 'turn_not_found',
      ...(debug ? { debug: { turn_check_error: tErr?.message || null } } : {}),
    });
  }

  const out = await notifyManagerForTurn(turn_id, kind ?? 'initial', { debug });

  if (!out.sent) {
    // don't redefine `sent`; just pass through `out`
    return res.status(409).json({ ok: false, ...out });
  }

  return res.status(200).json({ ok: true, ...out });
}
