// pages/api/submit-turn.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// Support both export styles (function returning client vs direct client)
const supa = typeof _admin === 'function' ? _admin() : _admin;

function nowIso() { return new Date().toISOString(); }
const E164 = /^\+?[1-9]\d{6,14}$/;

// ---------- SMS helpers ----------
function canSendSMS(rec) {
  if (!rec) return { ok: false, reason: 'no_recipient' };
  if (!rec.phone || !E164.test(String(rec.phone))) return { ok: false, reason: 'invalid_phone' };
  if (rec.sms_consent !== true) return { ok: false, reason: 'no_consent' };
  if (!rec.phone_verified_at) return { ok: false, reason: 'not_verified' };
  if (rec.sms_opt_out_at) return { ok: false, reason: 'opted_out' };
  return { ok: true };
}

async function twilioSend({ to, body }) {
  if (process.env.DISABLE_SMS === '1') return { ok: true, sid: 'test-mode', testMode: true };

  const sid  = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok  = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const msid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const from = (process.env.TWILIO_FROM || process.env.TWILIO_FROM_NUMBER || '').trim();
  if (!sid || !tok || (!msid && !from)) return { ok: false, reason: 'twilio_not_configured' };

  const { default: twilio } = await import('twilio');
  const client = twilio(sid, tok);
  const payload = msid ? { to, body, messagingServiceSid: msid } : { to, body, from };
  const msg = await client.messages.create(payload);
  return { ok: true, sid: msg.sid };
}

// Parse POST body into { turnId, photos[] }
function parseBody(raw) {
  let body = raw;
  if (typeof raw === 'string') {
    try { body = JSON.parse(raw); } catch { body = {}; }
  }
  const turnId = (body.turnId || body.turn_id || '').trim();
  const photos = Array.isArray(body.photos) ? body.photos : [];
  return { turnId, photos };
}

// Build normalized rows from capture payload
function buildRows(turnId, photos) {
  // capture.js sends: { name, shotId, url: up.path, width, height, preview }
  const rows = (photos || [])
    .map(p => {
      const storagePath = (p.path || p.url || '').toString().trim();
      if (!storagePath) return null;
      return {
        turn_id: turnId,
        _path_value: storagePath,
        shot_id: p.shotId || p.shot_id || null,
        area_key: p.area_key || '',
        created_at: nowIso(),
      };
    })
    .filter(Boolean);
  return rows;
}

// Try inserting into turn_photos with multiple column shapes
async function tolerantInsertTurnPhotos(rows) {
  if (!rows.length) return { ok: true, tried: 0 };

  const shapes = [
    r => ({ turn_id: r.turn_id, storage_path: r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, path:          r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, photo_path:    r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, url:           r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, file:          r._path_value, shot_id: r.shot_id, area_key: r.area_key, created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, storage_path:  r._path_value }),
    r => ({ turn_id: r.turn_id, path:          r._path_value }),
  ];

  let lastErr = null;
  let tried = 0;

  for (const make of shapes) {
    tried++;
    const payload = rows.map(make);
    const { error } = await supa.from('turn_photos').insert(payload, { returning: 'minimal' });
    if (!error) return { ok: true, tried };
    const msg = (error.message || '').toLowerCase();
    if (!/column|does not exist|null value|constraint|invalid input|duplicate/i.test(msg)) {
      lastErr = error; break;
    }
    lastErr = error;
  }

  return { ok: false, tried, error: lastErr };
}

// Fallback to legacy table if turn_photos fails
async function fallbackInsertLegacyPhotos(rows) {
  if (!rows.length) return { ok: true };
  const shapes = [
    r => ({ turn_id: r.turn_id, path:          r._path_value, area_key: r.area_key || '', created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, storage_path:  r._path_value, area_key: r.area_key || '', created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, photo_path:    r._path_value, area_key: r.area_key || '', created_at: r.created_at }),
    r => ({ turn_id: r.turn_id, url:           r._path_value, area_key: r.area_key || '', created_at: r.created_at }),
  ];
  let lastErr = null;
  for (const make of shapes) {
    const payload = rows.map(make);
    const { error } = await supa.from('photos').insert(payload, { returning: 'minimal' });
    if (!error) return { ok: true };
    const msg = (error.message || '').toLowerCase();
    if (!/column|does not exist|null value|constraint|invalid input|duplicate/i.test(msg)) {
      lastErr = error; break;
    }
    lastErr = error;
  }
  return { ok: false, error: lastErr };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { turnId, photos } = parseBody(req.body);
    if (!turnId) return res.status(400).json({ error: 'turnId is required' });

    const rows = buildRows(turnId, photos);

    // Insert photos with tolerant shapes
    if (rows.length) {
      const ins = await tolerantInsertTurnPhotos(rows);
      if (!ins.ok) {
        const fb = await fallbackInsertLegacyPhotos(rows);
        if (!fb.ok) {
          throw new Error((ins.error?.message || fb.error?.message) || 'could not insert photos');
        }
      }
    }

    // Mark the turn as submitted
    {
      const { error } = await supa
        .from('turns')
        .update({ status: 'submitted', submitted_at: nowIso() })
        .eq('id', turnId);
      if (error) throw error;
    }

    // Notify the property's manager (fire-and-forget, non-blocking)
    (async () => {
      try {
        // Load turn + property + cleaner
        const { data: info } = await supa
          .from('turns')
          .select(`
            id,
            property_id,
            cleaner_id,
            properties:property_id ( name, unit, manager_id, org_id ),
            cleaners:cleaner_id ( full_name, phone )
          `)
          .eq('id', turnId)
          .maybeSingle();

        const propertyName = [info?.properties?.name, info?.properties?.unit].filter(Boolean).join(' · ') || 'a property';
        const cleanerPhone = info?.cleaners?.phone || '';
        const cleanerName  = info?.cleaners?.full_name || '';
        const who = cleanerName || cleanerPhone || 'Cleaner';

        // Find property manager + consent flags
        const managerId = info?.properties?.manager_id;
        if (!managerId) return;

        const { data: mgr } = await supa
          .from('managers')
          .select('id, name, phone, sms_consent, sms_opt_out_at, phone_verified_at')
          .eq('id', managerId)
          .maybeSingle();

        const guard = canSendSMS(mgr);
        if (!guard.ok) return;

        // Review link for managers
        const base =
          process.env.APP_BASE_URL ||
          process.env.NEXT_PUBLIC_APP_BASE_URL ||
          process.env.NEXT_PUBLIC_SITE_URL ||
          'https://www.turnqa.com';
        const link = `${base.replace(/\/+$/, '')}/manager/turns/${turnId}`;

        const body =
`Turn submitted: ${propertyName}
${who} just finished a turn.
Review: ${link}
Reply STOP to opt out, HELP for help.`;

        await twilioSend({ to: mgr.phone, body });
      } catch (e) {
        console.warn('[submit-turn] notify manager failed', e);
      }
    })();

    return res.json({ ok: true });
  } catch (e) {
    console.error('submit-turn error', e);
    return res.status(500).json({ error: e.message || 'submit-turn failed' });
  }
}
