// pages/api/property-template.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supabase = typeof _admin === 'function' ? _admin() : _admin;

function getBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const property_id = String(req.query?.property_id || '').trim();
    if (!property_id) return res.status(400).json({ error: 'property_id is required' });

    // Require manager auth (uses the same token your /api/sign-photo uses)
    const token = getBearer(req);
    if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr) throw userErr;
    const userId = userData?.user?.id;
    if (!userId) return res.status(401).json({ error: 'Invalid session' });

    // Lookup manager row for this user
    const { data: mgr, error: mErr } = await supabase
      .from('managers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!mgr?.id) return res.status(403).json({ error: 'Not a manager account' });

    // Verify property belongs to this manager
    const { data: prop, error: pErr } = await supabase
      .from('properties')
      .select('id, name, manager_id')
      .eq('id', property_id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!prop) return res.status(404).json({ error: 'property not found' });
    if (String(prop.manager_id) !== String(mgr.id)) {
      return res.status(403).json({ error: 'Not authorized for this property' });
    }

    // Load template
    let { data: tpl, error: tErr } = await supabase
      .from('property_templates')
      .select('id, name, property_id')
      .eq('property_id', property_id)
      .limit(1)
      .maybeSingle();
    if (tErr) throw tErr;

    if (!tpl) {
      // Should exist already, but if not, return empty gracefully
      return res.status(200).json({
        property: prop.name,
        template: '',
        shots: [],
      });
    }

    // Load shots in order
    const { data: s, error: sErr } = await supabase
      .from('template_shots')
      .select('id, label, min_count, area_key, sort_index, created_at, reference_paths')
      .eq('template_id', tpl.id)
      .order('sort_index', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true });
    if (sErr) throw sErr;

    const shots = (s || []).map((row, idx) => ({
      shot_id: row.id, // ✅ important: capture page expects shot_id
      area_key: row.area_key || 'general',
      label: row.label || '(unnamed)',
      min_count: row.min_count || 1,
      reference_paths: Array.isArray(row.reference_paths) ? row.reference_paths : [],
      sort_index: typeof row.sort_index === 'number' ? row.sort_index : idx,
    }));

    return res.status(200).json({
      property: prop.name,
      template: tpl.name || '',
      shots,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
