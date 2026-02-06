// lib/sms.ts
// Minimal SMS helper used by API routes (needs-fix, etc.)
// Uses Twilio REST API directly (no SDK dependency).

type SendSmsArgs = {
  to: string;
  body: string;
};

export async function sendSmsMinimal({ to, body }: SendSmsArgs) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM;

  if (!accountSid || !authToken) {
    throw new Error('Twilio env missing: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN');
  }

  // Twilio requires either MessagingServiceSid OR From
  if (!messagingServiceSid && !from) {
    throw new Error('Twilio env missing: TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const form = new URLSearchParams();
  form.set('To', to);
  form.set('Body', body);
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
  else form.set('From', from as string);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Twilio send failed (${resp.status}): ${text}`);
  }

  const json = await resp.json().catch(() => ({}));
  return json;
}
