// pages/api/turns/[id]/needs-fix.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';

const supa = typeof _admin === 'function' ? _admin() : _admin;

// Optional Twilio (SMS). If not configured, we return testMode with the message.
let twilioClient = null;
try {
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  ) {
    const twilio = (await import('twilio')).default;
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
} catch (_) {
  // ignore optional import issues
}

function getBaseUrl(req) {
  // Prefer configured public URL; fall back to Origin header or host
  const envBase =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL; // e.g. project.vercel.app

  if (envBase) {
    return envBase.startsWith('http') ? envBase : `https://${envBase}`;
  }
  const origin = req.headers.origin;
  if (origin && origin.startsWith('http')) return origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || 'https';
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const turnId = String(req.query.id || req.query.turn_id || '').trim();
    if (!turnId) return res.status(400).json({ error: 'missing turn id' });

    // Body shape from your UI:
    // { notes: [{ path, note }], summary: string|null, send_sms: boolean }
    const body = await safeJson(req);
    const rawNotes = Array.isArray(body.notes) ? body.notes : [];
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    const sendSms = !!body.send_sms;

    // 1) Update turn status + manager note (singular) on the turn
    await supa
      .from('turns')
      .update({
        status: 'needs_fix',
        manager_note: summary || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', turnId);

    // 2) Persist findings (per-photo notes)
    //    We'll store into a table that your GET /api/turns/:id/findings reads back.
    //    Common schema we’ve used: turn_findings(turn_id, path, note, severity, created_at)
    //    Upsert by (turn_id, path) so re-sends overwrite.
    if (rawNotes.length) {
      const rows = rawNotes
        .filter(it => it && it.path && (it.note || '').toString().trim().length)
        .map(it => ({
          turn_id: turnId,
          path: String(it.path),
          note: String(it.note || '').trim(),
          severity: 'warn',
          created_at: new Date().toISOString(),
        }));

      if (rows.length) {
        // If your table is named differently, change this name:
        const { error: fErr } = await supa
          .from('turn_findings')
          .upsert(rows, { onConflict: 'turn_id,path' });

        if (fErr) {
          // Not fatal to the whole request; we still proceed to notify
          console.warn('[needs-fix] findings upsert failed', fErr.message || fErr);
        }
      }
    }

    // 3) Try to infer the first area_key from the paths provided (for &open=...)
    let firstAreaKey = null;
    try {
      const paths = rawNotes.map(n => n?.path).filter(Boolean);
      if (paths.length) {
        // a) find shot_id(s) for these paths
        const { data: tpRows } = await supa
          .from('turn_photos')
          .select('path, shot_id')
          .eq('turn_id', turnId)
          .in('path', [...new Set(paths)]);

        const shotIds = [...new Set((tpRows || []).map(r => r.shot_id).filter(Boolean))];

        if (shotIds.length) {
          // b) map shot_id -> area_key
          const { data: tsRows } = await supa
            .from('template_shots')
            .select('id, area_key')
            .in('id', shotIds);

          const map = Object.fromEntries((tsRows || []).map(r => [String(r.id), r.area_key || '']));
          // Pick the area_key of the first note’s path if possible
          const firstPath = paths[0];
          const firstShotId = (tpRows || []).find(r => r.path === firstPath)?.shot_id;
          if (firstShotId && map[firstShotId]) firstAreaKey = map[firstShotId];
        }
      }
    } catch (_) {
      // Non-blocking
    }

    // 4) Build the cleaner link to CAPTURE in needs-fix mode
    const base = getBaseUrl(req);
    const captureUrl =
      `${base}/turns/${encodeURIComponent(turnId)}/capture?tab=needs-fix` +
      (firstAreaKey ? `&open=${encodeURIComponent(firstAreaKey)}` : '');

    // 5) (Optional) Send SMS to the cleaner
    let notify = { sent: false, testMode: false, to: [] };
    if (sendSms) {
      // Find cleaner phone number
      let phone = null;
      try {
        // Prefer a direct phone on turns table
        const { data: turnRow } = await supa
          .from('turns')
          .select('id, cleaner_phone, cleaner_user_id')
          .eq('id', turnId)
          .single();

        phone = turnRow?.cleaner_phone || null;

        // If not present, try looking up in profiles by cleaner_user_id
        if (!phone && turnRow?.cleaner_user_id) {
          const { data: prof } = await supa
            .from('profiles')
            .select('id, phone')
            .eq('id', turnRow.cleaner_user_id)
            .maybeSingle();
          phone = prof?.phone || null;
        }
      } catch (_) {}

      const message = [
        'Manager requested a quick fix.',
        summary ? `Note: ${summary}` : null,
        rawNotes.length ? `(${rawNotes.length} photo${rawNotes.length > 1 ? 's' : ''} flagged)` : null,
        `Open to add the fix photo${rawNotes.length > 1 ? 's' : ''}: ${captureUrl}`,
      ]
        .filter(Boolean)
        .join(' ');

      if (!twilioClient || process.env.DISABLE_SMS === '1' || !phone) {
        notify = {
          sent: false,
          testMode: true,
          to: phone ? [phone] : [],
          message,
          url: captureUrl,
        };
      } else {
        try {
          const sms = await twilioClient.messages.create({
            to: phone,
            from: process.env.TWILIO_FROM_NUMBER,
            body: message,
          });
          notify = { sent: true, testMode: false, to: [phone], sid: sms.sid, url: captureUrl };
        } catch (e) {
          notify = {
            sent: false,
            testMode: true,
            to: [phone],
            message,
            url: captureUrl,
            error: e?.message || String(e),
          };
        }
      }
    }

    return res.json({
      ok: true,
      status: 'needs_fix',
      url: captureUrl,       // <— useful for clients/tests
      notify,                // {sent, testMode, to, ...}
    });
  } catch (e) {
    console.error('[needs-fix]', e);
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}

async function safeJson(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return {};
  }
}
