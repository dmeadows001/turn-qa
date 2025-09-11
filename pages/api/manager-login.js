// pages/api/manager-login.js
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { password } = body || {};
    if (!password) return res.status(400).json({ error: 'Missing password' });

    const expected = process.env.MANAGER_PASS;
    if (!expected) return res.status(500).json({ error: 'MANAGER_PASS not set' });

    if (password !== expected) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Set an HttpOnly cookie good for ~7 days
    res.setHeader('Set-Cookie', [
      `mgr=ok; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60*60*24*7}`
    ]);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
}
