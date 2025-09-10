// pages/api/properties/[id]/shots.js
import { supabaseAdmin } from '../../../../lib/supabase';

async function getActiveTemplateId(propertyId) {
  // find active template or create one
  const { data: tpl, error } = await supabaseAdmin
    .from('property_templates')
    .select('id')
    .eq('property_id', propertyId)
    .eq('is_active', true)
    .maybeSingle();

  if (!tpl) {
    const { data: created, error: cErr } = await supabaseAdmin
      .from('property_templates')
      .insert({ property_id: propertyId, name: 'Default', is_active: true })
      .select('id')
      .single();
    if (cErr) throw cErr;
    return created.id;
  }
  if (error) throw error;
  return tpl.id;
}

export default async function handler(req, res) {
  try {
    const { id } = req.query; // property id
    if (!id) return res.status(400).json({ error: 'Missing id' });

    if (req.method === 'GET') {
      const templateId = await getActiveTemplateId(id);
      const { data: shots, error } = await supabaseAdmin
        .from('template_shots')
        .select('id,area_key,label,min_count,notes,sort_order,created_at')
        .eq('template_id', templateId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ template_id: templateId, shots: shots || [] });
    }

    if (req.method === 'POST') {
      // Replace ALL shots with payload (simplest MVP)
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const shots = Array.isArray(body.shots) ? body.shots : [];
      const templateId = await getActiveTemplateId(id);

      // Wipe existing
      const { error: delErr } = await supabaseAdmin
        .from('template_shots')
        .delete()
        .eq('template_id', templateId);
      if (delErr) throw delErr;

      if (shots.length) {
        const rows = shots.map((s, i) => ({
          template_id: templateId,
          area_key: String(s.area_key || s.key || '').trim(),
          label: String(s.label || '').trim(),
          min_count: Number(s.min_count ?? s.minCount ?? 1),
          notes: s.notes ? String(s.notes) : null,
          sort_order: Number(s.sort_order ?? i * 10)
        })).filter(r => r.area_key && r.label);

        if (rows.length) {
          const { error: insErr } = await supabaseAdmin.from('template_shots').insert(rows);
          if (insErr) throw insErr;
        }
      }

      return res.status(200).json({ ok: true, template_id: templateId });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('api/property shots error:', e);
    res.status(500).json({ error: 'shots endpoint failed' });
  }
}

