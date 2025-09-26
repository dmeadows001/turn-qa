// pages/api/list-cleaner-turns.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  // Use service role on server so we can read reliably but we still filter by phone/cleaner_id
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function normPhone(raw = '') {
  const only = (raw || '').replace(/[^\d+]/g, '');
  if (!only) return '';
  if (only.startsWith('+')) return only;
  // naive US normalization if they type 10 digits
  if (/^\d{10}$/.test(only)) return `+1${only}`;
  return `+${only}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const qPhone = (req.query.phone || '').toString().trim();
    const cleanerId = (req.query.cleaner_id || '').toString().trim();

    let targetCleanerId = cleanerId;

    if (!targetCleanerId) {
      const phone = normPhone(qPhone);
      if (!phone) return res.status(400).json({ error: 'phone or cleaner_id required' });

      const { data: cl, error: cErr } = await supa
        .from('cleaners')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();

      if (cErr) throw cErr;
      if (!cl?.id) return res.json({ rows: [] });

      targetCleanerId = cl.id;
    }

    // Fetch this cleaner's turns (join property name)
    const { data, error } = await supa
      .from('turns')
      .select(`
        id,
        status,
        created_at,
        submitted_at,
        approved_at,
        needs_fix_at,
        property_id,
        properties:properties ( name )
      `)
      .eq('cleaner_id', targetCleanerId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const rows = (data || []).map(r => ({
      id: r.id,
      status: r.status || '',
      created_at: r.created_at,
      submitted_at: r.submitted_at,
      approved_at: r.approved_at,
      needs_fix_at: r.needs_fix_at,
      property_id: r.property_id,
      property_name: r.properties?.name || '(unnamed)',
    }));

    return res.json({ rows });
  } catch (e) {
    console.error('list-cleaner-turns error', e);
    return res.status(500).json({ error: e.message || 'list-cleaner-turns failed' });
  }
}
