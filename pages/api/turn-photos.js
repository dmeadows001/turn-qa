import { supabaseAdmin, supabaseClient } from '../../lib/supabase';

// Helper to sign a single storage key for short-lived viewing
async function signPath(path) {
  // 15 minutes validity
  const { data, error } = await supabaseAdmin
    .storage
    .from('photos')
    .createSignedUrl(path, 15 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export default async function handler(req, res) {
  try {
    const { turnId } = req.query;
    if (!turnId) return res.status(400).json({ error: 'Missing turnId' });

    // 1) Read photo metadata from DB
    const { data: rows, error: err } = await supabaseClient
      .from('photos')
      .select('*')
      .eq('turn_id', turnId)
      .order('created_at', { ascending: true });

    if (err) throw err;

    // 2) Sign each storage path so the browser can view the image
    const withUrls = await Promise.all(
      (rows || []).map(async (r) => ({
        ...r,
        signedUrl: await signPath(r.url)
      }))
    );

    res.status(200).json({ photos: withUrls });
  } catch (e) {
    console.error('turn-photos error:', e);
    res.status(500).json({ error: 'turn-photos failed' });
  }
}
