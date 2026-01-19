// pages/api/upload-url.js
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const admin = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

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

function sanitizeName(name = '') {
  const base = String(name).trim() || 'upload.jpg';
  return base
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140);
}

function nowIso() {
  return new Date().toISOString();
}

function mkId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { turnId, shotId, filename, mime } = req.body || {};
    const tId = String(turnId || req.query.turnId || '').trim();
    const sId = String(shotId || 'misc').trim();
    const name = sanitizeName(filename || 'upload.jpg');

    if (!tId) return res.status(400).json({ error: 'turnId required' });

    // ✅ Require auth
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Missing Authorization token' });

    const rls = createRlsClient(token);

    // ✅ RLS authorization: caller must be able to read this turn
    const { data: turn, error: tErr } = await rls
      .from('turns')
      .select('id')
      .eq('id', tId)
      .maybeSingle();

    if (tErr) throw tErr;
    if (!turn) return res.status(403).json({ error: 'Not authorized for this turn' });

    const key = `turns/${tId}/${sId}/${mkId()}_${name}`.replace(/\/+/g, '/');

    // 1) Supabase signed upload URL (preferred)
    let signedUploadUrl = null;
    let uploadToken = null;

    try {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(key);
      if (!error) {
        signedUploadUrl = data?.signedUrl || null;
        uploadToken = data?.token || null;
      } else {
        console.error('[upload-url] createSignedUploadUrl error:', error.message || error);
      }
    } catch (e) {
      console.error('[upload-url] createSignedUploadUrl exception:', e?.message || e);
    }

    // 2) Proxy fallback (unchanged)
    const uploadUrl = `/api/upload-proxy?path=${encodeURIComponent(key)}&bucket=${encodeURIComponent(BUCKET)}`;

    return res.json({
      ok: true,
      bucket: BUCKET,
      path: key,
      mime: mime || 'image/jpeg',
      uploadUrl,
      signedUploadUrl,
      token: uploadToken,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('[upload-url] fatal error', e?.message || e);
    return res.status(500).json({ error: e?.message || 'upload-url failed' });
  }
}
