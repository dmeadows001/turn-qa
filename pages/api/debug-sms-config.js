export default function handler(req, res) {
  res.json({
    has_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
    has_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
    has_MSG_SERVICE: !!(process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_MSG_SID),
    has_FROM_any: !!(
      process.env.TWILIO_FROM ||
      process.env.TWILIO_FROM_NUMBER ||
      process.env.TWILIO_PHONE_NUMBER ||
      process.env.TWILIO_SMS_FROM ||
      process.env.NEXT_PUBLIC_TWILIO_FROM
    ),
    site_url: process.env.NEXT_PUBLIC_SITE_URL || null
  });
}
