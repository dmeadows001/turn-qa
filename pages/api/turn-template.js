// pages/api/turn-template.js
import { supabaseClient } from '../../lib/supabase';

export default async function handler(req,res){
  try{
    const { turnId } = req.query;
    if(!turnId) return res.status(400).json({ error:'Missing turnId' });

    // read turn → property/template
    const { data: turn, error: tErr } = await supabaseClient
      .from('turns')
      .select('id, property_id, template_id')
      .eq('id', turnId)
      .single();
    if (tErr || !turn) return res.status(404).json({ error:'Turn not found' });

    // fallback: if no template_id, pick active template for the property
    let templateId = turn.template_id;
    if (!templateId && turn.property_id) {
      const { data: tpl } = await supabaseClient
        .from('property_templates')
        .select('id')
        .eq('property_id', turn.property_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      templateId = tpl?.id || null;
    }

    if (!templateId) {
      // Return an empty set; front-end can fallback to a default list
      return res.status(200).json({ shots: [], template: null });
    }

    const { data: shots, error: sErr } = await supabaseClient
      .from('template_shots')
      .select('area_key,label,min_count,notes,sort_order')
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true });

    if (sErr) throw sErr;

    res.status(200).json({
      template: { id: templateId, property_id: turn.property_id },
      shots: shots || []
    });
  } catch(e){
    console.error('turn-template error:', e);
    res.status(500).json({ error:'turn-template failed' });
  }
}
