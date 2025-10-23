// pages/api/upload-proxy.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

export const config = {
  api: {
    bodyParser: false, // we stream the raw body
    sizeLimit: '10mb', // adjust if you allow larger photos
  },
};

const supa = typeof _admin === 'function' ? _admin() : _admin;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const bucket = String(req.query.bucket || '').trim();
    const path = String(req.query.path || '').trim();
    if (!bucket || !path) {
      return res.status(400).json({ error: 'bucket and path are required' });
    }

    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const body = await readRawBody(req);

    const { error } = await supa.storage.from(bucket).upload(path, body, {
      contentType,
      upsert: false,
    });

    if (error) {
      console.error('[upload-proxy] storage.upload error:', error.message || error);
      return res.status(500).json({ error: 'upload failed' });
    }

    return res.status(200).json({ ok: true, path });
  } catch (e) {
    console.error('[upload-proxy] fatal error:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'upload-proxy failed' });
  }
}
