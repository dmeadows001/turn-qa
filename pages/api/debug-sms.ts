// pages/api/debug-sms.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // NEVER leak secrets; only show presence/boolean
  const flags = {
    DISABLE_SMS: process.env.DISABLE_SMS || '(unset)',
    has_TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
    has_TWILIO_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
    has_TWILIO_MESSAGING_SERVICE_SID: !!process.env.TWILIO_MESSAGING_SERVICE_SID,
    has_TWILIO_FROM_NUMBER: !!process.env.TWILIO_FROM_NUMBER,
    // which base URL the code will use in links:
    APP_BASE_URL: process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || '(default)',
    NODE_ENV: process.env.NODE_ENV,
  };
  res.status(200).json(flags);
}
