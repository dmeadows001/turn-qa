
// pages/api/start-turn.js
// Legacy endpoint retired.
// Active cleaner workflow uses /api/cleaner/start-turn.

export default function handler(req, res) {
  res.setHeader('Allow', ['POST']);

  return res.status(410).json({
    error: 'This legacy turnover endpoint is no longer available.',
    code: 'LEGACY_ENDPOINT_RETIRED'
  });
}
