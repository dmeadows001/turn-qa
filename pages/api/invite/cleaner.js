// pages/api/invite/cleaner.js
import { createClient } from '@supabase/supabase-js';

// ---- Supabase (service role so RLS doesn't block server reads/writes) ----
function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Normalize phone to E.164-like format we accept
function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function absoluteOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  return process.env.SITE_URL || `${proto}://${host}`;
}

export default async function handler(req, res) {
  const supabase = supabaseAdmin();

  // ------- GET: return invite details for onboard/cleaner?id=... -------
  if (req.method === 'GET') {
    try {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });

      const { data: inv, error } = await supabase
        .from('cleaner_invites')
        .select('id, name, phone, property_id, cleaner_id, accepted_at, created_at')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (!inv) return res.status(404).json({ error: 'invite not found' });

      let property_name = '';
      if (inv.property_id) {
        const { data: prop } = await supabase
          .from('properties')
          .select('name')
          .eq('id', inv.property_id)
          .maybeSingle();
        property_name = prop?.name || '';
      }

      return res.status(200).json({
        invite: {
          id: inv.id,
          name: inv.name || '',
          phone: normalizePhone(inv.phone || ''),
          property_id: inv.property_id || null,
          property_name,
          cleaner_id: inv.cleaner_id || null,
          accepted_at: inv.accepted_at || null,
          created_at: inv.created_at || null,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'get failed' });
    }
  }

  // ------- POST: create/upsert invite and (optionally) send SMS -------
  if (req.method === 'POST') {
    try {
      const { property_id, name, phone } = req.body || {};
      if (!property_id || !phone) {
        return res.status(400).json({ error: 'property_id and phone are required' });
      }
      const normPhone = normalizePhone(phone);

      // 1) Find or create the cleaner row by phone (and optional name)
      let cleanerId = null;

      // Try by phone first
      {
        const { data: found } = await supabase
          .from('cleaners')
          .select('id')
          .eq('phone', normPhone)
          .maybeSingle();
        if (found?.id) cleanerId = found.id;
      }

      // If not found, insert minimal cleaner record
      if (!cleanerId) {
        const toInsert = {
          name: name || '',
          phone: normPhone,
        };
        const { data: created, error: cErr } = await supabase
          .from('cleaners')
          .insert(toInsert)
          .select('id')
          .maybeSingle();
        if (cErr) {
          // If a concurrent create happened, try to reselect
          const { data: retry } = await supabase
            .from('cleaners')
            .select('id')
            .eq('phone', normPhone)
            .maybeSingle();
          if (!retry?.id) throw cErr;
          cleanerId = retry.id;
        } else {
          cleanerId = created?.id;
        }
      }

      if (!cleanerId) {
        throw new Error('Could not resolve cleaner_id for phone');
      }

      // 2) Upsert the invite with cleaner_id (matches unique index on property_id,phone)
      const { data: up, error: upErr } = await supabase
        .from('cleaner_invites')
        .upsert(
          { property_id, name: name || '', phone: normPhone, cleaner_id: cleanerId },
          { onConflict: 'property_id,phone' }
        )
        .select('id')
        .maybeSingle();
      if (upErr) throw upErr;

      const inviteId = up?.id;
      if (!inviteId) throw new Error('could not upsert invite');

      // 3) Build absolute link
      const origin = absoluteOrigin(req);
      const link = `${origin}/onboard/cleaner?id=${inviteId}`;

      // 4) Send SMS if Twilio is configured; otherwise just return the link
      const sid   = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from  = process.env.TWILIO_FROM_NUMBER;
      const svc   = process.env.TWILIO_MESSAGING_SERVICE_SID;

      if (sid && token && (from || svc)) {
        const twilio = require('twilio')(sid, token);
        const params = {
          to: normPhone,
          body: `TurnQA: Your onboarding link: ${link}`,
        };
        if (svc) params.messagingServiceSid = svc; else params.from = from;
        await twilio.messages.create(params);
      }

      return res.status(200).json({ ok: true, inviteId, link, cleaner_id: cleanerId });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'post failed' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
