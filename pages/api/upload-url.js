// pages/api/upload-url.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

// IMPORTANT: supabaseAdmin in your repo is a factory function.
const supa = typeof _admin === 'function' ? _admin() : _admin;

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

function sanitizeName(name = '') {
  const base = String(name).trim() || 'upload.jpg';
  return base
    .replace(/[^\w.\-]+/g, '_')     // safe chars
    .replace(/^_+|_+$/g, '')
    .slice(0, 140);
}

function nowIso() { return new Date().toISOString(); }

// prefer Node 18+ uuid if present
function mkId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
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

    // Canonical object key (what the UI stores later).
    const key = `turns/${tId}/${sId}/${mkId()}_${name}`.replace(/\/+/g, '/');

    // 1) Primary: Supabase "signed upload" (multipart/form-data)
    //    Client must POST { file, token } to signedUploadUrl.
    let signedUploadUrl = null;
    let token = null;

    try {
      const { data, error } = await supa.storage
        .from(BUCKET)
        .createSignedUploadUrl(key);

      if (error) {
        console.error('[upload-url] createSignedUploadUrl error:', error.message || error);
      } else {
        signedUploadUrl = data?.signedUrl || null;
        token = data?.token || null;
      }
    } catch (e) {
      console.error('[upload-url] createSignedUploadUrl exception:', e?.message || e);
    }

    // 2) Fallback: a proxy endpoint you host that writes using service role.
    //    Your capture.js prefers `uploadUrl` first; it will PUT the raw bytes there.
    //    (See pages/api/upload-proxy.js below.)
    const uploadUrl = `/api/upload-proxy?path=${encodeURIComponent(key)}&bucket=${encodeURIComponent(BUCKET)}`;

    return res.json({
      ok: true,
      bucket: BUCKET,
      path: key,
      mime: mime || 'image/jpeg',
      // Give the client *both* options; it will choose what it supports.
      uploadUrl,            // <-- proxy PUT (service role; bypasses RLS)
      signedUploadUrl,      // <-- Supabase signed form-data POST
      token,                // <-- must be included in the form when using signedUploadUrl
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('[upload-url] fatal error', e?.message || e);
    return res.status(500).json({ error: e?.message || 'upload-url failed' });
  }
}
