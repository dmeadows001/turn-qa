// pages/api/qa/flag.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = createServerSupabaseClient({ req, res });

  // body: { turnId: string, photoId: string, checked: boolean, note?: string, severity?: string }
  const { turnId, photoId, checked, note, severity } = req.body || {};

  if (!turnId || !photoId || typeof checked !== 'boolean') {
    return res.status(400).json({ error: 'turnId, photoId, and checked are required' });
  }

  if (checked) {
    // mark as needs-fix (upsert = create or update)
    const { error } = await supabase
      .from('qa_findings')
      .upsert(
        [{ turn_id: turnId, photo_id: photoId, note: note ?? null, severity: severity ?? null }],
        { onConflict: 'turn_id,photo_id' }
      );
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, state: 'flagged' });
  } else {
    // clear needs-fix
    const { error } = await supabase
      .from('qa_findings')
      .delete()
      .eq('turn_id', turnId)
      .eq('photo_id', photoId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, state: 'cleared' });
  }
}
