// pages/api/upload-url.js
import { supabaseAdmin } from '../../lib/supabase';

// Simple filename sanitizer
function sanitizeName(name='') {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const turnId = String(body.turnId || '').trim();
    const shotId = body.shotId ? String(body.shotId).trim() : ''; // NEW
    const areaKey = body.areaKey ? String(body.areaKey).trim() : ''; // fallback
    const filename = sanitizeName(String(body.filename || 'photo.jpg'));
    const mime = String(body.mime || 'image/jpeg');

    if (!turnId || (!shotId && !areaKey)) {
      return res.status(400).json({ error: 'Missing turnId or shotId/areaKey' });
    }

    // Folder: prefer shotId; else areaKey for backward compat
    const folder = shotId || areaKey;
    const stamped = `${Date.now()}-${filename}`;
    const path = `turns/${turnId}/${folder}/${stamped}`;

    // Create a one-time signed upload URL (PUT)
    const { data, error } = await supabaseAdmin
      .storage
      .from('photos')
      .createSignedUploadUrl(path, 60); // valid for 60s

    if (error) throw error;

    return res.status(200).json({
      uploadUrl: data.signedUrl,
      path,      // store this in DB and in client state
      mime
    });
  } catch (e) {
    console.error('upload-url error:', e);
    res.status(500).json({ error: 'upload-url failed' });
  }
}
