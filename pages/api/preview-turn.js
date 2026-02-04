// pages/api/preview-turn.js
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { property_id } = req.body || {};
    if (!property_id) return res.status(400).json({ error: 'Missing property_id' });

    // Create a lightweight "preview" turn.
    // IMPORTANT: This is a real DB row, but we mark it preview so you can later ignore/cleanup if you want.
    const { data: turn, error } = await supabaseAdmin
      .from('turns')
      .insert({
        property_id,
        status: 'in_progress',
        is_preview: true,            // ✅ add this column if you want; otherwise remove this line
        created_via: 'template_preview', // optional; remove if column doesn't exist
      })
      .select('id')
      .single();

    if (error) throw error;

    return res.status(200).json({ ok: true, turn_id: turn.id });
  } catch (e) {
    console.error('preview-turn error:', e);
    return res.status(500).json({ error: e?.message || 'Preview turn failed' });
  }
}
