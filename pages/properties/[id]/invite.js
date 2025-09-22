// pages/properties/[id]/invite.js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function InviteCleaner() {
  const router = useRouter();
  const propertyId = router.query.id;

  const [prop, setProp] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name')
        .eq('id', propertyId)
        .single();
      if (!error) setProp(data);
    })();
  }, [propertyId]);

  async function onSubmit(e) {
    e.preventDefault();
    setMsg('');
    setErr('');
    try {
      if (!propertyId) throw new Error('Missing property id.');
      if (!name.trim()) throw new Error('Enter a cleaner name.');
      if (!phone.trim()) throw new Error('Enter a phone number.');
      setSending(true);

      const r = await fetch('/api/invite/cleaner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          cleaner_name: name.trim(),
          phone: phone.trim(),
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Invite failed');

      setMsg('Invite sent! If you are on a Twilio trial, the number must be verified and the SMS will be short.');
    } catch (e) {
      setErr(e.message || 'Invite failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <ChromeDark title={`Invite Cleaner — ${prop?.name || ''}`}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
        <h1 style={ui.h1}>Invite Cleaner — {prop?.name || '…'}</h1>

        <div style={ui.card}>
          <div style={{ color: ui.muted, marginBottom: 12 }}>
            We’ll text them a secure link to verify consent and access the photo capture page.
          </div>

          <form onSubmit={onSubmit}>
            <label style={ui.label}>Cleaner name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Sam Rivera"
              style={ui.input}
            />

            <label style={{ ...ui.label, marginTop: 12 }}>Phone number</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 555 1234"
              style={ui.input}
            />

            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                type="submit"
                disabled={sending}
                style={ui.buttonPrimary}
              >
                {sending ? 'Sending…' : 'Send SMS invite'}
              </button>

              <a href={`/properties/${propertyId}/template`} style={ui.linkButton}>← Back to template</a>
              <a href="/dashboard" style={ui.linkButton}>Dashboard</a>
            </div>

            {msg ? <div style={{ ...ui.good, marginTop: 10 }}>{msg}</div> : null}
            {err ? <div style={{ ...ui.bad, marginTop: 10 }}>Invite failed: {err}</div> : null}

            <div style={{ color: ui.muted, fontSize: 13, marginTop: 12 }}>
              Tip: On a Twilio <b>trial</b>, messages can only go to verified numbers and must be short.
            </div>
          </form>
        </div>
      </div>
    </ChromeDark>
  );
}
