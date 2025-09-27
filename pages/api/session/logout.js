// pages/api/session/logout.js
import { clearCleanerCookie } from '../../../lib/session';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  res.setHeader('Set-Cookie', clearCleanerCookie());
  res.json({ ok: true });
}
