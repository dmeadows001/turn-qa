// pages/api/resubmit-turn.js
import { supabaseAdmin } from '../../lib/supabase';
import twilio from 'twilio';

/** Build an absolute url for links in SMS */
function absUrl(req, path = '/') {
  const proto = (req.headers['x-forwarded-proto'] || 'https');
  const host  = (req.headers['x-forwarded-host'] || req.headers.host || process.env.NEXT_PUBLIC_SITE_URL || 'localhost:3000');
  const base  = `${proto}://${host}`.replace(/\/+$/,'');
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Twilio sender config (Messaging Service preferred; fall back to From number) */
function getTwilioSender() {
  const sid  = process.env.TWILIO_ACCOUNT_SID;
  const tok  = process.env.TWILIO_AUTH_TOKEN;
  const svc  = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
  const from = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_FROM || '';

  if (!sid || !tok) return { ok:false, error:'Twilio credentials missing', client:null, opts:null };
  if (!svc && !from) return { ok:false, error:'Twilio sender not configured (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM)', client:null, opts:null };

  const client = twilio(sid, tok);
  const opts   = svc ? { messagingServiceSid: svc } : { from };
  return { ok:true, client, opts };
}

/** Normalize phone input to E.164-ish (keeps +) */
function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : ('+' + digits);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error:'Method Not Allowed' });

  try {
    const { turn_id, reply = '', photos = [] } = (req.body || {});
    const tid = (turn_id || '').trim();
    if (!tid) return res.status(400).json({ error:'turn_id is required' });

    // 1) Load the turn (to get property_id, etc.)
    const { data: turn, error: tErr } = await supabaseAdmin
      .from('turns')
      .select('id, property_id, status')
      .eq('id', tid)
      .single();
    if (tErr) throw tErr;
    if (!turn) return res.status(404).json({ error:'Turn not found' });

    // 2) Insert fix photos (if any)
    const cleanPhotos = Array.isArray(photos) ? photos.filter(p => p && p.path) : [];
    if (cleanPhotos.length > 0) {
      const rows = cleanPhotos.map(p => ({
        turn_id: tid,
        storage_path: p.path,   // we store only storage_path; your list endpoint already coalesces it
        area_key: 'fix'         // optional tag; useful context in gallery
      }));
      const { error: insErr } = await supabaseAdmin
        .from('turn_photos')
        .insert(rows);
      if (insErr) throw insErr;
    }

    // 3) Update turn status + cleaner reply + resubmitted_at
    const { error: upErr } = await supabaseAdmin
      .from('turns')
      .update({
        status: 'submitted',
        cleaner_reply: reply || null,
        resubmitted_at: new Date().toISOString()
      })
      .eq('id', tid);
    if (upErr) throw upErr;

    // 4) Find the property + manager (via properties.manager_id)
    const { data: prop, error: pErr } = await supabaseAdmin
      .from('properties')
      .select('id, name, manager_id')
      .eq('id', turn.property_id)
      .single();
    if (pErr) throw pErr;

    let managerPhone = null;
    let managerName  = null;
    if (prop?.manager_id) {
      const { data: mgr, error: mErr } = await supabaseAdmin
        .from('managers')
        .select('id, name, phone, sms_consent')
        .eq('id', prop.manager_id)
        .single();
      if (!mErr && mgr) {
        managerPhone = mgr.phone ? normalizePhone(mgr.phone) : null;
        managerName  = mgr.name || null;
        // Optional: honor consent if you track it
        if (mgr.sms_consent === false) {
          managerPhone = null;
        }
      }
    }

    // 5) SMS notify manager (if we have a phone + Twilio config)
    if (managerPhone) {
      const cfg = getTwilioSender();
      if (cfg.ok) {
        const reviewUrl = absUrl(req, `/turns/${tid}/review?manager=1`);
        // Keep the body short (trial-friendly). Include STOP/HELP footer.
        const propName = prop?.name ? ` ${prop.name}` : '';
        const replySnippet = reply ? ` Note: ${reply}` : '';
        const body = `TurnQA: fixes submitted for${propName}.${replySnippet} Review: ${reviewUrl} STOP to end, HELP for help.`;

        try {
          await cfg.client.messages.create({
            to: managerPhone,
            ...cfg.opts,
            body
          });
        } catch (e) {
          // Don’t fail the whole request if SMS fails; just log it.
          console.error('resubmit-turn SMS failed:', e?.message || e);
        }
      }
    }

    return res.json({ ok:true });
  } catch (e) {
    console.error('resubmit-turn error:', e);
    return res.status(500).json({ error: e.message || 'failed' });
  }
}
