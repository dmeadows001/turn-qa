import { createClient } from '@supabase/supabase-js';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!url) throw new Error('Missing env NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('Missing env SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { property_id } = req.body || {};
    if (!property_id) {
      return res.status(400).json({ error: 'Missing property_id' });
    }

    const supabase = getAdminClient();

    // Find the template for this property
    const { data: tpl, error: tplErr } = await supabase
      .from('property_templates')
      .select('id, name')
      .eq('property_id', property_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (tplErr) throw tplErr;
    if (!tpl?.id) {
      return res.status(400).json({ error: 'No template found for this property' });
    }

    // Create a new "in_progress" turn tied to that template
    const { data: turn, error: insErr } = await supabase
      .from('turns')
      .insert({
        property_id,
        template_id: tpl.id,
        status: 'in_progress',
      })
      .select('id')
      .single();

    if (insErr) throw insErr;

    return res.status(200).json({ ok: true, turn_id: turn.id });
  } catch (e) {
    console.error('[preview-turn] error:', e);
    return res.status(500).json({ error: e?.message || 'Internal Server Error' });
  }
}
