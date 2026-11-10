// pages/api/turns/[id]/findings.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const turnId = String(req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'Missing turn id' });

    const supa = typeof supabaseAdmin === 'function' ? supabaseAdmin() : supabaseAdmin;
    // Active findings are the only outstanding corrections; old rounds remain in history.
    const { data, error } = await supa
      .from('qa_findings')
      .select([
        'id', 'correction_task_id', 'photo_id', 'evidence_url', 'area_key', 'label',
        'note', 'note_original', 'note_translated', 'note_original_lang',
        'note_translated_lang', 'note_sent', 'note_sent_lang',
        'severity', 'created_at', 'review_round',
      ].join(', '))
      .eq('turn_id', turnId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const findings = (data || []).map((r: any) => ({
      id: r.id,
      // Older active findings predate correction_task_id. Their finding ID is
      // the stable legacy identifier used by the submit-fix endpoint.
      correction_task_id: r.correction_task_id || r.id,
      photo_id: r.photo_id || null,
      path: r.evidence_url || '',
      area_key: r.area_key || '',
      label: r.label || '',
      note: r.note || '',
      note_original: r.note_original || '',
      note_translated: r.note_translated || '',
      note_original_lang: r.note_original_lang || null,
      note_translated_lang: r.note_translated_lang || null,
      note_sent: r.note_sent || '',
      note_sent_lang: r.note_sent_lang || null,
      severity: r.severity || null,
      created_at: r.created_at || null,
      review_round: r.review_round || 1,
    }));
    return res.status(200).json({ findings });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
