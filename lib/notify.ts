// lib/notify.ts
import { createClient } from '@supabase/supabase-js';

const E164 = /^\+[1-9]\d{6,14}$/;
function canSend(rec?: { phone?: string | null; sms_consent?: boolean | null; sms_opt_out_at?: string | null; phone_verified_at?: string | null; }) {
  if (!rec) return { ok: false, reason: 'no_rec' };
  if (!rec.phone || !E164.test(rec.phone)) return { ok: false, reason: 'no_phone' };
  if (rec.sms_consent !== true) return { ok: false, reason: 'no_consent' };
  if (!rec.phone_verified_at) return { ok: false, reason: 'not_verified' };
  if (rec.sms_opt_out_at) return { ok: false, reason: 'opted_out' };
  return { ok: true };
}

async function twilioSend(to: string, body: string) {
  const sid  = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok  = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const mss  = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const from = (process.env.TWILIO_FROM_NUMBER || '').trim();

  if (process.env.DISABLE_SMS === '1') return { ok: true, testMode: true };
  if (!sid || !tok || (!mss && !from)) return { ok: false, reason: 'twilio_not_configured' };

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
          'https://www.turnqa.com').replace(/\/+$/,'');
}

/** Notify the property's manager that the turn has a new submission. */
export async function notifyManagerForTurn(turnId: string, kind: 'initial'|'fix') {
  const supa = supaAdmin();

  const { data: info } = await supa
    .from('turns')
    .select(`
      id, property_id, cleaner_id, created_at,
      properties:property_id ( name, manager_id, org_id ),
      cleaners:cleaner_id ( full_name, phone )
    `)
    .eq('id', turnId)
    .maybeSingle();

  if (!info) return { sent: 0, reason: 'turn_not_found' };

  // choose manager
  let managerId = info.properties?.manager_id || null;
  if (!managerId && info.properties?.org_id) {
    // fallback: most recently verified manager in same org
    const { data: cand } = await supa
      .from('managers')
      .select('id, phone, sms_consent, sms_opt_out_at, phone_verified_at')
      .eq('org_id', info.properties.org_id)
      .order('phone_verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    managerId = cand?.id ?? null;
  }
  if (!managerId) return { sent: 0, reason: 'no_manager' };

  const { data: mgr } = await supa
    .from('managers')
    .select('id, name, phone, sms_consent, sms_opt_out_at, phone_verified_at')
    .eq('id', managerId).maybeSingle();

  const guard = canSend(mgr!);
  if (!guard.ok) return { sent: 0, reason: guard.reason, manager: mgr };

  const who = info.cleaners?.full_name || info.cleaners?.phone || 'Cleaner';
  const propName = info.properties?.name || 'a property';
  const link = `${siteBase()}/manager/turns/${turnId}`;
  const verb = kind === 'fix' ? 'submitted fixes' : 'submitted a turn';
  const body =
`TurnQA: ${who} ${verb} for "${propName}".
Review: ${link}
Reply STOP to opt out, HELP for help.`;

  const sent = await twilioSend(String(mgr?.phone), body);
  if (!sent.ok) return { sent: 0, reason: sent.reason || 'send_failed', body };
  return { sent: 1, to: [mgr?.phone], body, testMode: !!sent.testMode };
}

/** Optional: notify cleaner when manager requests more fixes (call this from that action). */
export async function notifyCleanerForTurn(turnId: string, message: string) {
  const supa = supaAdmin();
  const { data: info } = await supa
    .from('turns')
    .select(`
      id, property_id, cleaner_id,
      properties:property_id ( name ),
      cleaners:cleaner_id ( full_name, phone, sms_consent, sms_opt_out_at, phone_verified_at )
    `)
    .eq('id', turnId)
    .maybeSingle();

  if (!info || !info.cleaners) return { sent: 0, reason: 'cleaner_not_found' };

  const guard = canSend(info.cleaners);
  if (!guard.ok) return { sent: 0, reason: guard.reason };

  const link = `${siteBase()}/turns/${turnId}/fixes`;
  const body =
`TurnQA: ${message}
Property: ${info.properties?.name || 'your recent turn'}
Submit fixes: ${link}
Reply STOP to opt out, HELP for help.`;

  const sent = await twilioSend(String(info.cleaners.phone), body);
  if (!sent.ok) return { sent: 0, reason: sent.reason || 'send_failed', body };
  return { sent: 1, to: [info.cleaners.phone], body, testMode: !!sent.testMode };
}
