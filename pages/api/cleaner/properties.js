// pages/api/cleaner/properties.js
import { supabaseAdmin } from '@/lib/supabaseAdmin'; // server-side singleton

function normalizePhone(s = '') {
  const d = (s || '').replace(/[^\d+]/g, '');
  return d ? (d.startsWith('+') ? d : `+${d}`) : '';
}

export default async function handler(req, res) {
  // This uses the service-role key (no session; RLS bypass as configured).
  const supa = supabaseAdmin();

  try {
    // Accept phone from POST body or GET query
    const phone = normalizePhone(
      (req.method === 'POST' ? req.body?.phone : req.query?.phone) || ''
    );
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    // 1) Find cleaner by phone
    const { data: cleaner, error: cleanerErr } = await supa
      .from('cleaners')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();
    if (cleanerErr) throw cleanerErr;

    let properties = [];

    if (cleaner?.id) {
      // 2) Preferred: properties assigned to this cleaner via join table
      const { data: assigned, error: assignedErr } = await supa
        .from('property_cleaners')
        .select('property_id, properties:properties(name)')
        .eq('cleaner_id', cleaner.id);
      if (assignedErr) throw assignedErr;

      properties = (assigned || []).map(r => ({
        id: r.property_id,
        name: r.properties?.name || r.property_id
      }));
    }

    if (properties.length === 0) {
      // 3) Fallback: open invites for this phone
      const { data: invited, error: invitedErr } = await supa
        .from('cleaner_invites')
        .select('property_id, properties:properties(name)')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(10);
      if (invitedErr) throw invitedErr;

      properties = (invited || []).map(r => ({
        id: r.property_id,
        name: r.properties?.name || r.property_id
      }));
    }

    return res.status(200).json({ cleaner, properties });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'lookup failed' });
  }
}
