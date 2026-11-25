// pages/api/property/assign-manager.js
// Retired legacy endpoint. Property ownership must not be assigned
// through unauthenticated, browser-supplied manager and property IDs.

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(410).json({
    error: 'Legacy property assignment is disabled.',
  });
}
