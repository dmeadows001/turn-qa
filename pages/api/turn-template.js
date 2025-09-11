// pages/api/turn-template.js
import { supabaseClient } from '../../lib/supabase';

export default async function handler(req,res){
  try{
    const { turnId } = req.query;
    if(!turnId) return res.status(400).json({ error:'Missing turnId' });

    const { data: turn, error: tErr } = await supabaseClient
      .from('turns')
      .select('id, property_id, template_id')
      .eq('id', turnId)
      .single();
    if (tErr || !turn) return res.status(404).json({ error:'Turn not found' });

    // property rules
    let propertyRules = '';
    if (turn.property_id) {
      const { data: prop } = await supabaseClient
        .from('properties')
        .select('rules_text')
        .eq('id', turn.property_id)
        .maybeSingle();
      propertyRules = prop?.rules_text || '';
    }

    // template id
    let templateId = turn.template_id;
    if (!templateId && turn.property_id) {
      const { data: tpl } = await supabaseClient
        .from('property_templates')
        .select('id, rules_text')
        .eq('property_id', turn.property_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      templateId = tpl?.id || null;
    }

    if (!templateId) {
      return res.status(200).json({ shots: [], template: null, rules: { property: propertyRules, template: '', } });
    }

    const { data: templateRow } = await supabaseClient
      .from('property_templates')
      .select('id, rules_text')
      .eq('id', templateId)
      .single();

    const { data: shots, error: sErr } = await supabaseClient
      .from('template_shots')
      .select('id, area_key, label, min_count, notes, sort_order, rules_text')
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true });

    if (sErr) throw sErr;

    const mapped = (shots || []).map(s => ({
      shot_id: s.id,
      area_key: s.area_key,
      label: s.label,
      min_count: s.min_count,
      notes: s.notes || '',
      rules_text: s.rules_text || ''
    }));

    res.status(200).json({
      template: { id: templateId, property_id: turn.property_id },
      rules: {
        property: propertyRules || '',
        template: templateRow?.rules_text || ''
      },
      shots: mapped
    });
  } catch(e){
    console.error('turn-template error:', e);
    res.status(500).json({ error:'turn-template failed' });
  }
}
