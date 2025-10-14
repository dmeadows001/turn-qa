// pages/api/managers/turn-submitted.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { notifyManagerForTurn } from '@/lib/notify';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { turn_id, kind } = req.body as { turn_id?: string; kind?: 'initial' | 'fix' };
  if (!turn_id) return res.status(400).json({ error: 'turn_id required' });

  const out = await notifyManagerForTurn(turn_id, kind ?? 'initial');
  // If we didn't send, return a 409 with the reason (matches what you saw)
  const status = out.sent ? 200 : 409;
  return res.status(status).json({ ok: !!out.sent, ...out });
}
