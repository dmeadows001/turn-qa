// pages/api/invite/supervisor.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { requireActiveSubscription } from '@/lib/requireActiveSubscription';

const supa = typeof _admin === 'function' ? _admin() : _admin;

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!/^[+\d\s().-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  const phone = raw.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const access = await requireActiveSubscription(req, res);
  if (!access.ok) return;

  try {
    const { property_id, phone: rawPhone, name: rawName } = req.body || {};
    const phone = normalizePhone(rawPhone);
    const name = String(rawName || '').trim().slice(0, 120) || null;
    if (typeof property_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(property_id) || !phone) {
      return res.status(400).json({ error: 'Valid property and phone required' });
    }
    const { data: manager, error: mErr } = await supa.from('managers').select('id').eq('user_id', access.user.id).maybeSingle();
    if (mErr) throw mErr;
    if (!manager) return res.status(403).json({ error: 'Manager account not found' });
    const { data: property, error: pErr } = await supa.from('properties').select('id, name, is_active, is_archived').eq('id', property_id).eq('manager_id', manager.id).maybeSingle();
    if (pErr) throw pErr;
    if (!property || property.is_archived || property.is_active === false) return res.status(404).json({ error: 'Property unavailable or access denied' });

    // Invitations remain pending until the separate acceptance flow is implemented.
    // Do not grant membership, create companies, or send a dead invitation link.
    return res.status(503).json({ error: 'Supervisor invitations are not enabled yet.' });
  } catch (error) {
    console.error('[invite/supervisor] request failed', error?.code || 'internal_error');
    return res.status(500).json({ error: 'Unable to create supervisor invitation' });
  }
}
