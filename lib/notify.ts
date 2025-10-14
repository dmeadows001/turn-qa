// lib/notify.ts
import { createClient } from '@supabase/supabase-js';

const E164 = /^\+[1-9]\d{6,14}$/;

function canSend(rec?: {
  phone?: string | null;
  sms_consent?: boolean | null;
  sms_opt_out_at?: string | null;
  phone_verified_at?: string | null;
}) {
  if (!rec) return { ok: false as const, reason: 'no_rec' as const };
  if (!rec.phone || !E164.test(String(rec.phone))) return { ok: false as const, reason: 'invalid_phone' as const };
  if (rec.sms_consent !== true) return { ok: false as const, reason: 'no_consent' as const };
  if (!rec.phone_verified_at) return { ok: false as const, reason: 'not_verified' as const };
  if (rec.sms_opt_out_at) return { ok: false as const, reason: 'opted_out' as const };
  return { ok: true as const };
}

async function twilioSend(to: string, body: string) {
  if (process.env.DISABLE_SMS === '1') return { ok: true, testMode: true, used: 'TEST' as const };

  const sid  = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok  = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const mss  = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const from = (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_FROM || '').trim();

  if (!sid || !tok || (!mss && !from)) {
    return { ok: false as const, reason: 'twilio_not_configured' as const };
  }

  const { default: twilio } = await import('twilio');
  const client = twilio(sid, tok);
  const payload: any = mss ? { to, body, messagingServiceSid: mss } : { to, body, from };
  const msg = await client.messages.create(payload);
  return { ok: true as const, sid: msg.sid, used: mss ? 'MSS' as const : 'FROM' as const };
}

function supaAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-TurnQA-Admin': '1' } },
  });
}

function siteBase() {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://www.turnqa.com'
  ).replace(/\/+$/, '');
}

export async function notifyManagerForTurn(turnId: string, kind: 'initial' | 'fix', opts?: { debug?: boolean }) {
  const debug = !!opts?.debug;
  const supa = supaAdmin();
  const dbg: any = { turn_id: turnId, phase: 'start' };

  // 1) Load the turn row
  const { data: turn, error: tErr } = await supa
    .from('turns')
    .select('id, property_id, cleaner_id, created_at')
    .eq('id', turnId)
    .maybeSingle();

  if (debug) dbg.turn_error = tErr?.message || null;
  if (!turn) {
    return { sent: 0, reason: 'turn_not_found' as const, debug: debug ? dbg : undefined };
  }

  // 2) Load property (separate, no relation aliases)
  const { data: prop, error: pErr } = await supa
    .from('properties')
    .select('id, name, unit, manager_id, org_id')
    .eq('id', turn.property_id)
    .maybeSingle();

  if (debug) dbg.property_error = pErr?.message || null;

  // 3) Load cleaner (optional; for name in SMS)
  const { data: cleaner, error: cErr } = await supa
    .from('cleaners')
    .select('id, full_name, name, phone')
    .eq('id', turn.cleaner_id)
    .maybeSingle();

  if (debug) dbg.cleaner_error = cErr?.message || null;

  // 4) Resolve manager id
  let managerId: string | null = prop?.manager_id ?? null;

  if (!managerId && prop?.org_id) {
    const { data: mCand } = await supa
      .from('managers')
      .select('id, phone_verified_at')
      .eq('org_id', prop.org_id)
      .order('phone_verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    managerId = mCand?.id ?? null;
  }

  if (!managerId) {
    return { sent: 0, reason: 'no_manager' as const, debug: debug ? dbg : undefined };
  }

  // 5) Load manager + consent fields
  const { data: mgr, error: mErr } = await supa
    .from('managers')
    .select('id, name, phone, sms_consent, sms_opt_out_at, phone_verified_at')
    .eq('id', managerId)
    .maybeSingle();

  if (debug) dbg.manager_error = mErr?.message || null;
  if (!mgr) {
    return { sent: 0, reason: 'manager_not_found' as const, debug: debug ? dbg : undefined };
  }

  const guard = canSend(mgr);
  if (!guard.ok) {
    return { sent: 0, reason: guard.reason, manager: { id: mgr.id, phone: mgr.phone }, debug: debug ? dbg : undefined };
  }

  // 6) Build body + link
  const who = cleaner?.full_name || cleaner?.name || cleaner?.phone || 'Cleaner';
  const propName = [prop?.name, prop?.unit].filter(Boolean).join(' · ') || 'a property';
  const link = `${siteBase()}/turns/${turnId}/review?manager=1`;
  const verb = kind === 'fix' ? 'submitted fixes' : 'submitted a turn';
  const body = `TurnQA: ${who} ${verb} for "${propName}".\nReview: ${link}\nReply STOP to opt out, HELP for help.`;

  // 7) Send
  try {
    const sent = await twilioSend(String(mgr.phone), body);
    if (!sent.ok) return { sent: 0, reason: (sent as any).reason || 'send_failed', body, debug: debug ? dbg : undefined };
    return { sent: 1, to: [mgr.phone], body, sid: (sent as any).sid, used: (sent as any).used, testMode: !!(sent as any).testMode, debug: debug ? dbg : undefined };
  } catch (e: any) {
    return { sent: 0, reason: 'twilio_error' as const, error: e?.message || String(e), debug: debug ? dbg : undefined };
  }
}
