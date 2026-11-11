// pages/api/update-turn-status.js
import { requireActiveSubscription } from '@/lib/requireActiveSubscription';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

function nowIso() {
  return new Date().toISOString();
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* fall through */ }
  }
  return req.body || {};
}

function siteBase() {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://www.turnqa.com'
  ).replace(/\/+$/, '');
}

function twilioClient() {
  if (process.env.DISABLE_SMS === '1') return null;
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !tok) return null;
  const twilio = require('twilio');
  return twilio(sid, tok);
}

async function sendSmsSafe({ to, body }) {
  try {
    if (process.env.DISABLE_SMS === '1') return { ok: true, testMode: true };
    const client = twilioClient();
    if (!client) return { ok: false, warn: 'twilio not configured' };
    const msid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
    const from = (process.env.TWILIO_FROM_NUMBER || '').trim();
    const payload = msid ? { to, body, messagingServiceSid: msid } : { to, body, from };
    if (!payload.messagingServiceSid && !payload.from) {
      return { ok: false, warn: 'twilio from/messaging sid missing' };
    }
    const msg = await client.messages.create(payload);
    return { ok: true, sid: msg.sid };
  } catch (e) {
    console.error('[update-turn-status] SMS error', e);
    return { ok: false, warn: e.message || 'sms failed' };
  }
}

// A correction is accepted only when the most recent decision for its task
// explicitly says "accepted". Inactive findings are still part of the audit
// trail; is_active=false is NOT evidence of manager acceptance.
async function checkCorrectionApprovals(turnId) {
  const { data: findings, error: findingsErr } = await supa
    .from('qa_findings')
    .select('id, correction_task_id')
    .eq('turn_id', turnId);
  if (findingsErr) throw findingsErr;

  const taskIds = new Set(
    (findings || []).map(f => f.correction_task_id || f.id).filter(Boolean)
  );
  if (taskIds.size === 0) return { ready: true, total: 0, pending: 0 };

  const { data: decisions, error: decisionsErr } = await supa
    .from('correction_decisions')
    .select('id, correction_task_id, decision, created_at')
    .eq('turn_id', turnId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (decisionsErr) throw decisionsErr;

  const latestByTask = new Map();
  for (const decision of decisions || []) {
    if (!latestByTask.has(decision.correction_task_id)) {
      latestByTask.set(decision.correction_task_id, decision.decision);
    }
  }

  let pending = 0;
  for (const taskId of taskIds) {
    if (latestByTask.get(taskId) !== 'accepted') pending += 1;
  }
  return { ready: pending === 0, total: taskIds.size, pending };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const access = await requireActiveSubscription(req, res);
  if (!access.ok) return;

  try {
    const { turn_id, new_status, manager_note } = parseBody(req);
    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });
    if (!new Set(['needs_fix', 'approved']).has(new_status)) {
      return res.status(400).json({ error: 'new_status must be needs_fix or approved' });
    }

    const { data: turn, error: tErr } = await supa
      .from('turns')
      .select('id, property_id, cleaner_id, status')
      .eq('id', turn_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error: 'turn not found' });

    const { data: manager, error: mErr } = await supa
      .from('managers')
      .select('id')
      .eq('user_id', access.user.id)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!manager) return res.status(403).json({ error: 'Manager account not found' });

    const { data: property, error: pErr } = await supa
      .from('properties')
      .select('id')
      .eq('id', turn.property_id)
      .eq('manager_id', manager.id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!property) {
      return res.status(404).json({ error: 'Turnover not found or access denied' });
    }

    // Final status changes require a submitted turn. Correction requests are
    // handled by /api/turns/[id]/needs-fix, which records individual findings.
    if (turn.status !== 'submitted') {
      return res.status(409).json({
        error: 'Only a submitted turnover can be reviewed or approved',
        currentStatus: turn.status,
      });
    }
    if (new_status === 'needs_fix') {
      return res.status(400).json({
        error: 'Use the needs-fix endpoint to request corrections and record findings',
      });
    }

    // Atomic final approval; the database locks this turn and checks every
    // correction decision before allowing status to change.
    const { error: approveErr } = await supa.rpc('approve_turn_if_ready', {
      p_turn_id: turn_id,
      p_manager_id: manager.id,
      p_manager_note: typeof manager_note === 'string' ? manager_note : null,
    });
    if (approveErr) {
      const code = String(approveErr.message || '').match(/(CORRECTIONS_PENDING|TURN_NOT_SUBMITTED|PROPERTY_ACCESS_DENIED|TURN_NOT_FOUND)/)?.[1];
      if (code) return res.status(409).json({ error: code, code });
      throw approveErr;
    }

    let warn = null;
    try {
      if (!turn.cleaner_id) {
        warn = 'No cleaner assigned to this turnover; SMS skipped';
      } else {
        const { data: cleaner, error: cErr } = await supa
          .from('cleaners')
          .select('phone, sms_consent, phone_verified_at, sms_opt_out_at')
          .eq('id', turn.cleaner_id)
          .maybeSingle();
        if (cErr) throw cErr;
        if (!cleaner) warn = 'Turnover cleaner not found; SMS skipped';
        else if (!cleaner.phone) warn = 'Cleaner has no phone; SMS skipped';
        else if (
          cleaner.sms_consent !== true ||
          !cleaner.phone_verified_at ||
          cleaner.sms_opt_out_at
        ) {
          warn = 'Cleaner is not eligible for SMS; SMS skipped';
        } else {
          const result = await sendSmsSafe({
            to: cleaner.phone,
            body: 'TurnQA: Your turn was approved.\nReply STOP to opt out, HELP for help.',
          });
          if (!result.ok) warn = result.warn || 'SMS failed';
        }
      }
    } catch (smsErr) {
      console.warn('[update-turn-status] notify warn:', smsErr?.message || smsErr);
      warn = smsErr?.message || 'notify failed';
    }

    return res.status(200).json({ ok: true, warn });
  } catch (e) {
    console.error('[update-turn-status] fatal', e);
    return res.status(500).json({ error: e.message || 'unexpected error' });
  }
}
