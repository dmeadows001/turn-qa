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

    // Your canonical object key (this is what the UI stores/uses later)
    const key = `turns/${tId}/${sId}/${mkId()}_${name}`.replace(/\/+/g, '/');

    // Create a signed *upload* URL (multipart/form-data) + token.
    // NOTE: This does NOT write the object yet; client will POST file + token.
    const { data, error } = await supa.storage
      .from(BUCKET)
      .createSignedUploadUrl(key);

    if (error) {
      console.error('[upload-url] createSignedUploadUrl error:', error.message || error);
      return res.status(500).json({ error: 'Failed to create signed upload URL' });
    }

    // Respond with everything the client needs.
    // - path: the object key to persist with the photo row
    // - signedUploadUrl: where to POST the file
    // - token: must be included in the multipart/form-data along with 'file'
    return res.json({
      ok: true,
      bucket: BUCKET,
      path: key,
      mime: mime || 'image/jpeg',
      signedUploadUrl: data?.signedUrl || null,
      token: data?.token || null,
      // optional metadata for debugging:
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('[upload-url] fatal error', e?.message || e);
    return res.status(500).json({ error: e?.message || 'upload-url failed' });
  }
}
