// pages/api/start-turn.js
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { cleaner_name, service_date, property_id } = req.body || {};
    if (!cleaner_name || !property_id || !service_date) {
      return res.status(400).json({ error: 'Missing cleaner_name, property_id or service_date' });
    }

    // Normalize date (expecting YYYY-MM-DD from the cleaners page)
    const dateStr = String(service_date).slice(0, 10);

    // 1) Try to reuse an existing in_progress turn for the same property/date/cleaner
    {
      const { data: existing, error: findErr } = await supabaseAdmin
        .from('turns')
        .select('id, status')
        .eq('property_id', property_id)
        .eq('turn_date', dateStr)
        .eq('cleaner_name', cleaner_name)
        .eq('status', 'in_progress')
        .limit(1)
        .maybeSingle();

      if (findErr) {
        console.error('start-turn find existing error:', findErr);
      } else if (existing?.id) {
        return res.status(200).json({ turn_id: existing.id, reused: true });
      }
    }

    // 2) Create a new turn
    const insertPayload = {
      property_id,
      cleaner_name,
      turn_date: dateStr,
      status: 'in_progress'
      // manager_notes, submitted_at, approved_at will be null by default
    };

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('turns')
      .insert([insertPayload])
      .select('id')
      .single();

    if (insErr) throw insErr;

    return res.status(200).json({ turn_id: inserted.id, reused: false });
  } catch (e) {
    console.error('start-turn error:', e);
    return res.status(500).json({ error: e.message || 'failed' });
  }
}
