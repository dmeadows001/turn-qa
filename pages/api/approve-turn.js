
// pages/api/approve-turn.js
// Legacy approval endpoint disabled for security.
// Active manager approvals use /api/update-turn-status.

export default function handler(req, res) {
  res.setHeader('Allow', ['POST']);

  return res.status(410).json({
    error: 'This approval endpoint has been retired.',
  });
}
