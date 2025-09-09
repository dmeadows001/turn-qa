import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { turnId, status, finding } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!turnId || !status) return res.status(400).json({ error: 'Missing fields' });

    // update status
    const { error: uErr } = await supabaseAdmin.from('turns').update({ status }).eq('id', turnId);
    if (uErr) throw uErr;

    // optional finding row
    if (finding) {
      const { error: fErr } = await supabaseAdmin.from('qa_findings').insert({
        turn_id: turnId,
        area_key: finding.area_key || null,
        label: finding.label || null,
        severity: finding.severity || 'warn',
        note: finding.note || null,
        evidence_url: finding.evidence_url || null
      });
      if (fErr) throw fErr;
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('mark-turn error:', e);
    res.status(500).json({ error: 'mark-turn failed' });
  }
}
