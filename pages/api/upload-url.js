import { supabaseAdmin } from '../../lib/supabase';
import { v4 as uuid } from 'uuid';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { turnId, areaKey, filename, mime } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!turnId || !areaKey || !filename) return res.status(400).json({ error: 'Missing fields' });

    const path = `turns/${turnId}/${areaKey}/${uuid()}-${filename}`;

    // Create a signed URL that allows a one-time PUT upload.
    const { data, error } = await supabaseAdmin
      .storage
      .from('photos')
      .createSignedUploadUrl(path);

    if (error) throw error;

    res.status(200).json({
      path,                   // key inside the bucket
      uploadUrl: data.signedUrl,
      token: data.token,
      mime: mime || 'image/jpeg'
    });
  } catch (e) {
    console.error('upload-url error:', e);
    res.status(500).json({ error: 'upload-url failed' });
  }
}

