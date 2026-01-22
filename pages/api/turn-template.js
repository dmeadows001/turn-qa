// pages/api/turn-template.js
import { createClient } from '@supabase/supabase-js';

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function createRlsClient(token) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Missing SUPABASE url/anon key');

  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export default async function handler(req, res) {
  try {
    const turnId = String(req.query.turnId || req.query.id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Missing Authorization token' });

    const rls = createRlsClient(token);

    // 1) Turn → property_id (RLS enforced)
    const { data: turn, error: tErr } = await rls
      .from('turns')
      .select('id, property_id')
      .eq('id', turnId)
      .maybeSingle();

    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'Turn not found' });

    // 2) Property name (RLS enforced)
    let propertyName = '';
    {
      const { data: prop, error: pErr } = await rls
        .from('properties')
        .select('name')
        .eq('id', turn.property_id)
        .maybeSingle();
      if (pErr) throw pErr;

      // If RLS blocks it, treat as not found / unauthorized
      if (!prop) return res.status(404).json({ error: 'Property not found' });

      propertyName = prop?.name || '';
    }

    // 3) Pick template (prefer active + newest) (RLS enforced)
    const { data: tpl, error: tplErr } = await rls
      .from('property_templates')
      .select('id, name, property_id, rules_text, is_active, created_at')
      .eq('property_id', turn.property_id)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tplErr) throw tplErr;

    // 4) Load shots (RLS enforced)
    let shots = [];
    if (tpl) {
      const { data: rawShots, error: sErr } = await rls
        .from('template_shots')
        .select('id, label, required, min_count, area_key, notes, rules_text, reference_paths, created_at')
        .eq('template_id', tpl.id)
        .order('created_at', { ascending: true });
      if (sErr) throw sErr;

      shots = (rawShots || []).map((s) => ({
        shot_id: s.id,
        area_key: s.area_key || 'general',
        label: s.label || 'Photo',
        min_count: Number.isFinite(s.min_count) ? s.min_count : (s.required ? 1 : 1),
        notes: s.notes || '',
        rules_text: s.rules_text || '',
        reference_paths: Array.isArray(s.reference_paths) ? s.reference_paths : (s.reference_paths || []),
      }));
    }

    // Fallback defaults (unchanged)
    if (shots.length === 0) {
      shots = [
        { shot_id: 'default-entry', area_key: 'entry', label: 'Entry - Overall', min_count: 1, reference_paths: [] },
        { shot_id: 'default-kitchen', area_key: 'kitchen', label: 'Kitchen - Overall', min_count: 2, reference_paths: [] },
        { shot_id: 'default-bath', area_key: 'bathroom', label: 'Bathroom - Overall', min_count: 2, reference_paths: [] },
      ];
    }

    const rules = { property: propertyName, template: tpl?.name || '' };

    return res.json({
      ok: true,
      turn_id: turn.id,
      property_id: turn.property_id,
      property_name: propertyName,
      template_id: tpl?.id || null,
      rules,
      shots,
    });
  } catch (e) {
    console.error('turn-template error:', e);
    return res.status(500).json({ error: e?.message || 'server error' });
  }
}
