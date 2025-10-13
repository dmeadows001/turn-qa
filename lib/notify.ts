// lib/notify.ts
import { createClient } from '@supabase/supabase-js';

const E164 = /^\+[1-9]\d{6,14}$/;

function canSend(rec?: {
  phone?: string | null;
  sms_consent?: boolean | null;
  sms_opt_out_at?: string | null;
  phone_verified_at?: string | null;
}) {
  if (!rec) return { ok: false, reason: 'no_rec' as const };
  if (!rec.phone || !E164.test(rec.phone)) return { ok: false, reason: 'no_phone' as const };
  if (rec.sms_consent !== true) return { ok: false, reason: 'no_consent' as const };
  if (!rec.phone_verified_at) return { ok: false, reason: 'not_verified' as const };
  if (rec.sms_opt_out_at) return { ok: false, reason: 'opted_out' as const };
  return { ok: true as const };
}

async function twilioSend(to: string, body: string) {
  const sid  = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok  = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const mss  = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const from = (process.env.TWILIO_FROM_NUMBER || '').trim();

  if (process.env.DISABLE_SMS === '1') return { ok: true, testMode: true };
  if (!sid || !tok || (!mss && !from)) return { ok: false as const, reason: 'twilio_not_configured' as const };

  const { default: twilio } = await import('twilio');
  const client = twilio(sid, tok);
  const payload = mss ? { to, body, messagingServiceSid: mss } : { to, body, from };
  await client.messages.create(payload);
  return { ok: true };
}

function supaAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
  return createClient(url, key);
}

function siteBase() {
  return (process.env.APP_BASE_URL ||
          process.env.NEXT_PUBLIC_APP_BASE_URL ||
          process.env.NEXT_PUBLIC_SITE_URL ||
          'https://www.turnqa.com').replace(/\/+$/, '');
}

/** Unwraps possible array relation into single object */
function firstOrNull<T>(x: T | T[] | null | undefined): T | null {
  if (!x) return null;
  return Array.isArray(x) ? (x[0] ?? null) : (x as T);
}

/** Notify the property's manager that the turn has a new submission. */
export async function notifyManagerForTurn(turnId: string, kind: 'initial' | 'fix') {
  const supa = supaAdmin();

  const { data: info, error } = await supa
    .from('turns')
    .select(`
      id, property_id, cleaner_id, created_at,
      properties:property_id ( name, manager_id, org_id ),
      cleaners:cleaner_id ( full_name, name, phone )
    `)
    .eq('id', turnId)
    .maybeSingle();

  if (error || !info) return { sent: 0, reason: 'turn_not_found' as const };

  // unwrap relations that might arrive as arrays
  const prop    = firstOrNull<any>((info as any)?.properties);
  const cleaner = firstOrNull<any>((info as any)?.cleaners);

  // choose manager
  let managerId: string | null = prop?.manager_id ?? null;

  if (!managerId && prop?.org_id) {
    // fallback: most recently verified manager in same org
    const { data: cand } = await supa
      .from('managers')
      .select('id, phone, sms_consent, sms_opt_out_at, phone_verified_at')
      .eq('org_id', prop.org_id)
      .order('phone_verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    managerId = cand?.id ?? null;
  }
  if (!managerId) return { sent: 0, reason: 'no_manager' as const };

  const { data: mgr } = await supa
    .from('managers')
    .select('id, name, phone, sms_consent, sms_opt_out_at, phone_verified_at')
    .eq('id', managerId)
    .maybeSingle();

  const guard = canSend(mgr!);
  if (!guard.ok) return { sent: 0, reason: guard.reason, manager: mgr };

  const who = cleaner?.full_name || cleaner?.name || cleaner?.phone || 'Cleaner';
  const propName = prop?.name || 'a property';
  const link = `${siteBase()}/manager/turns/${turnId}`;
  const verb = kind === 'fix' ? 'submitted fixes' : 'submitted a turn';
  const body =
`TurnQA: ${who} ${verb} for "${propName}".
Review: ${link}
Reply STOP to opt out, HELP for help.`;

  const sent = await twilioSend(String(mgr?.phone), body);
  if (!sent.ok) return { sent: 0, reason: (sent as any).reason || 'send_failed', body };
  return { sent: 1, to: [mgr?.phone], body, testMode: !!(sent as any).testMode };
}

/** Optional: notify cleaner when manager requests more fixes (call this from that action). */
export async function notifyCleanerForTurn(turnId: string, message: string) {
  const supa = supaAdmin();
  const { data: info } = await supa
    .from('turns')
    .select(`
      id, property_id, cleaner_id,
      properties:property_id ( name ),
      cleaners:cleaner_id ( full_name, name, phone, sms_consent, sms_opt_out_at, phone_verified_at )
    `)
    .eq('id', turnId)
    .maybeSingle();

  if (!info) return { sent: 0, reason: 'turn_not_found' as const };

  const prop    = firstOrNull<any>((info as any)?.properties);
  const cleaner = firstOrNull<any>((info as any)?.cleaners);

  const guard = canSend(cleaner as any);
  if (!guard.ok) return { sent: 0, reason: guard.reason };

  const link = `${siteBase()}/turns/${turnId}/fixes`;
  const body =
`TurnQA: ${message}
Property: ${prop?.name || 'your recent turn'}
Submit fixes: ${link}
Reply STOP to opt out, HELP for help.`;

  const sent = await twilioSend(String((cleaner as any)?.phone), body);
  if (!sent.ok) return { sent: 0, reason: (sent as any).reason || 'send_failed', body };
  return { sent: 1, to: [ (cleaner as any)?.phone ], body, testMode: !!(sent as any).testMode };
}
