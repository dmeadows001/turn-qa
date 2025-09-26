// pages/api/turn-template.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.turnId || req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    // 1) Turn → property_id
    const { data: turn, error: tErr } = await supabase
      .from('turns')
      .select('id, property_id')
      .eq('id', turnId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Property name
    let propertyName = '';
    {
      const { data: prop, error: pErr } = await supabase
        .from('properties')
        .select('name')
        .eq('id', turn.property_id)
        .maybeSingle();
      if (pErr) throw pErr;
      propertyName = prop?.name || '';
    }

    // 3) Pick template (prefer active + newest)
    const { data: tpl, error: tplErr } = await supabase
      .from('property_templates')
      .select('id, name, property_id, rules_text, is_active, created_at')
      .eq('property_id', turn.property_id)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tplErr) throw tplErr;

    // 4) Load shots
    let shots = [];
    if (tpl) {
      const { data: rawShots, error: sErr } = await supabase
        .from('template_shots')
        .select('id, label, required, min_count, area_key, notes, rules_text, created_at')
        .eq('template_id', tpl.id)
        .order('created_at', { ascending: true });
      if (sErr) throw sErr;

      shots = (rawShots || []).map(s => ({
        shot_id: s.id,
        area_key: s.area_key || 'general',
        label: s.label || 'Photo',
        min_count: Number.isFinite(s.min_count) ? s.min_count : (s.required ? 1 : 1),
        notes: s.notes || '',
        rules_text: s.rules_text || ''
      }));
    }

    // Fallback defaults
    if (shots.length === 0) {
      shots = [
        { shot_id: 'default-entry',   area_key: 'entry',    label: 'Entry - Overall',     min_count: 1 },
        { shot_id: 'default-kitchen', area_key: 'kitchen',  label: 'Kitchen - Overall',   min_count: 2 },
        { shot_id: 'default-bath',    area_key: 'bathroom', label: 'Bathroom - Overall',  min_count: 2 }
      ];
    }

    const rules = {
      property: propertyName,           // <-- now set
      template: tpl?.name || ''
    };

    return res.json({
      ok: true,
      turn_id: turn.id,
      property_id: turn.property_id,
      property_name: propertyName,      // <-- helpful extra
      template_id: tpl?.id || null,
      rules,
      shots
    });
  } catch (e) {
    console.error('turn-template error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
