
// pages/api/session/login-by-phone.js

// SECURITY: This legacy endpoint previously issued authenticated
// cleaner sessions based solely on a supplied phone number.
//
// Cleaner sessions must only be created after successful
// verification of an SMS one-time code.
//
// Keep this endpoint disabled to prevent authentication bypass.

export default function handler(req, res) {
  res.setHeader('Allow', 'POST');
  res.setHeader('Cache-Control', 'no-store');

  return res.status(410).json({
    error: 'This authentication endpoint has been retired.',
    code: 'LEGACY_LOGIN_DISABLED',
  });
}
