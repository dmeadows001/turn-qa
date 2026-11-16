
import { clearCleanerCookie } from '@/lib/session';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      error: 'Method Not Allowed',
    });
  }

  res.setHeader('Set-Cookie', clearCleanerCookie(req));

  return res.status(200).json({
    ok: true,
  });
}
