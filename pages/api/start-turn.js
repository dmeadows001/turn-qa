// pages/api/start-turn.js
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const cleaner_name = (body.cleaner_name || '').trim();
    const date_str = body.date; // 'YYYY-MM-DD'
    const property_id = body.property_id;

    if (!cleaner_name || !date_str || !property_id) {
      return res.status(400).json({ error: 'Missing cleaner_name, date, or property_id' });
    }

    // Find active template (optional)
    let template_id = null;
    {
      const { data: tpl } = await supabaseAdmin
        .from('property_templates')
        .select('id')
        .eq('property_id', property_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      template_id = tpl?.id || null;
    }

    // Insert new turn (let DB generate UUID)
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('turns')
      .insert([{
        property_id,
        template_id,
        status: 'in_progress',
        turn_date: date_str,        // ensure you have a date column; adjust name if needed
        cleaner_name                // ensure you have this column; add it if not
      }])
      .select('id')
      .single();

    if (insErr) throw insErr;
    return res.status(200).json({ turn_id: inserted.id });
  } catch (e) {
    console.error('start-turn error:', e);
    res.status(500).json({ error: e.message || 'failed to start turn' });
  }
}
