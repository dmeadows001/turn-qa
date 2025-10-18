// pages/api/turns/[id]/findings.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'; // factory function in your repo

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const turnId = String(req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'Missing turn id' });

    // Read from qa_findings (evidence_url is the path)
    const { data, error } = await supabaseAdmin
      .from('qa_findings')
      .select('evidence_url, note, severity, created_at')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const findings = (data || []).map(r => ({
      path: r.evidence_url || '',     // map DB column to the name the UI expects
      note: r.note || '',
      severity: r.severity || null,
      created_at: r.created_at || null,
    }));

    return res.status(200).json({ findings });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
