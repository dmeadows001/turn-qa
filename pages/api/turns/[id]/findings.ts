// pages/api/turns/[id]/findings.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const turnId = String(req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'Missing turn id' });

    const supa = typeof supabaseAdmin === 'function' ? supabaseAdmin() : supabaseAdmin;

    const { data, error } = await supa
      .from('qa_findings')
      .select(
        [
          'evidence_url',
          'note',
          'note_original',
          'note_translated',
          'note_original_lang',
          'note_translated_lang',
          'severity',
          'created_at',
        ].join(', ')
      )
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const findings = (data || []).map((r: any) => ({
      path: r.evidence_url || '',
      note: r.note || '',

      // bilingual fields (safe defaults)
      note_original: r.note_original || '',
      note_translated: r.note_translated || '',
      note_original_lang: r.note_original_lang || null,
      note_translated_lang: r.note_translated_lang || null,

      severity: r.severity || null,
      created_at: r.created_at || null,
    }));

    res.status(200).json({ findings });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed' });
  }
}
