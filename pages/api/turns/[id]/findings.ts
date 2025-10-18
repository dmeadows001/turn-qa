// pages/api/turns/[id]/findings.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'; // factory function in your repo

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id;
  const turnId = Array.isArray(id) ? id[0] : id;
  if (!turnId) {
    return res.status(400).json({ error: 'Missing turn id' });
  }

  try {
    const sb = supabaseAdmin(); // ← create the admin client

    // Note: PostgREST aliasing uses column:alias (no spaces)
    const { data, error } = await sb
      .from('qa_findings')
      .select('evidence_url:path, note, severity, created_at')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const findings = (data || [])
      .map((row: any) => ({
        path: row.path || row.evidence_url || '',
        note: row.note || '',
        severity: row.severity || 'warn',
        created_at: row.created_at,
      }))
      .filter(f => f.path);

    return res.status(200).json({ findings });
  } catch (e: any) {
    console.error('GET /api/turns/[id]/findings failed', e);
    return res.status(500).json({ error: e?.message || 'Failed to load findings' });
  }
}
