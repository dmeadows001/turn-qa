// pages/api/list-cleaner-turns.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function normPhone(raw = '') {
  const only = (raw || '').replace(/[^\d+]/g, '');
  if (!only) return '';
  if (only.startsWith('+')) return only;
  if (/^\d{10}$/.test(only)) return `+1${only}`; // naive US default
  return `+${only}`;
}

async function selectTurnsTolerant(cleanerId) {
  const base = supa.from('turns');
  const common = base
    .eq('cleaner_id', cleanerId)
    .order('created_at', { ascending: false })
    .limit(200);

  // 1) Try with needs_fix_at
  try {
    const { data, error } = await common.select(`
      id,
      status,
      created_at,
      submitted_at,
      approved_at,
      needs_fix_at,
      property_id,
      properties:properties ( name )
    `);
    if (error) throw error;
    return (data || []).map(r => ({
      id: r.id,
      status: r.status || '',
      created_at: r.created_at,
      submitted_at: r.submitted_at,
      approved_at: r.approved_at,
      needs_fix_at: r.needs_fix_at ?? null,
      property_id: r.property_id,
      property_name: r.properties?.name || '(unnamed)',
    }));
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    const missingNeedsFix =
      msg.includes('column') && msg.includes('needs_fix_at') && msg.includes('does not exist');

    if (!missingNeedsFix) throw e;

    // 2) Fallback without needs_fix_at
    const { data, error } = await common.select(`
      id,
      status,
      created_at,
      submitted_at,
      approved_at,
      property_id,
      properties:properties ( name )
    `);
    if (error) throw error;
    return (data || []).map(r => ({
      id: r.id,
      status: r.status || '',
      created_at: r.created_at,
      submitted_at: r.submitted_at,
      approved_at: r.approved_at,
      needs_fix_at: null, // not in schema
      property_id: r.property_id,
      property_name: r.properties?.name || '(unnamed)',
    }));
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const qPhone = (req.query.phone || '').toString().trim();
    const cleanerIdParam = (req.query.cleaner_id || '').toString().trim();

    let cleanerId = cleanerIdParam;

    // Resolve cleaner by phone if cleaner_id not provided
    if (!cleanerId) {
      const phone = normPhone(qPhone);
      if (!phone) return res.status(400).json({ error: 'phone or cleaner_id required' });

      const { data: cl, error: cErr } = await supa
        .from('cleaners')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();

      if (cErr) throw cErr;
      if (!cl?.id) return res.json({ rows: [] });
      cleanerId = cl.id;
    }

    const rows = await selectTurnsTolerant(cleanerId);
    return res.json({ rows });
  } catch (e) {
    console.error('list-cleaner-turns error', e);
    return res.status(500).json({ error: e.message || 'list-cleaner-turns failed' });
  }
}
