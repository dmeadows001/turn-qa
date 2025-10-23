// pages/api/upload-proxy.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

export const config = { api: { bodyParser: true, sizeLimit: '10mb' } }; // up to ~10MB payloads

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

// supabaseAdmin is a factory in your repo
const supa = typeof _admin === 'function' ? _admin() : _admin;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { path, mime, dataBase64 } = req.body || {};
    if (!path || !dataBase64) return res.status(400).json({ error: 'path and dataBase64 are required' });

    // Decode base64 (dataBase64 should be raw base64, no data: URL)
    const buf = Buffer.from(dataBase64, 'base64');

    const { error } = await supa.storage
      .from(BUCKET)
      .upload(path, buf, { upsert: false, contentType: mime || 'application/octet-stream' });

    if (error) return res.status(500).json({ error: error.message || 'upload failed' });

    return res.json({ ok: true, path });
  } catch (e) {
    console.error('[upload-proxy] error', e);
    return res.status(500).json({ error: e?.message || 'upload failed' });
  }
}
