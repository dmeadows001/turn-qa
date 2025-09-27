// pages/api/get-turn.js
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const id = (req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Fetch the turn (include property name via FK relationship)
    // Assumes turns.property_id -> properties.id FK exists.
    const { data, error } = await supabaseAdmin
      .from('turns')
      .select(`
        id,
        status,
        cleaner_name,
        turn_date,
        property_id,
        manager_notes,
        submitted_at,
        approved_at,
        needs_fix_at,
        created_at,
        properties ( name )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Turn not found' });

    // Flatten property name for convenience
    const turn = {
      ...data,
      property_name: data?.properties?.[0]?.name ?? data?.properties?.name ?? null
    };
    delete turn.properties;

    return res.status(200).json({ turn });
  } catch (e) {
    console.error('get-turn error:', e);
    return res.status(500).json({ error: e.message || 'failed' });
  }
}
