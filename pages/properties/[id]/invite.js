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

export default function InviteCleanerPage() {
  const router = useRouter();
  const { id: propertyId } = router.query;

  const [loading, setLoading] = useState(true);
  const [property, setProperty] = useState(null);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(''); // Expect E.164 or raw digits; backend can normalize
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('properties')
          .select('id, name')
          .eq('id', propertyId)
          .single();
        if (error) throw error;
        setProperty(data);
        setMsg('');
      } catch (e) {
        setMsg(e.message || 'Failed to load property');
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId]);

  async function sendInvite(e) {
    e?.preventDefault?.();
    try {
      setMsg('');
      if (!name.trim()) throw new Error('Enter the cleaner’s name.');
      if (!phone.trim()) throw new Error('Enter a phone number.');
      setSending(true);

+ const r = await fetch('/api/invite/cleaner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      property_id: propertyId,
      cleaner_name: name.trim(),
      phone: phone.trim()
    })
  });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Invite failed');
      setMsg('Invite sent ✅');
      setName('');
      setPhone('');
    } catch (e) {
      setMsg(e.message || 'Could not send invite');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <ChromeDark title="Invite Cleaner">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Loading…</div>
        </section>
      </ChromeDark>
    );
  }

  if (!property) {
    return (
      <ChromeDark title="Invite Cleaner">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Property not found.</div>
        </section>
      </ChromeDark>
    );
  }

  return (
    <ChromeDark title={`Invite Cleaner — ${property.name}`}>
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>
            Invite a cleaner to <span style={{ color: '#cbd5e1' }}>{property.name}</span>
          </h2>
          <div style={ui.subtle}>
            We’ll text them a secure link to verify consent and access the photo capture page.
          </div>

          <form onSubmit={sendInvite} style={{ marginTop: 14 }}>
            <label style={ui.label} htmlFor="cleanerName">Cleaner name</label>
            <input
              id="cleanerName"
              type="text"
              placeholder="e.g., Alex R."
              style={ui.input}
              value={name}
              onChange={e => setName(e.target.value)}
            />

            <label style={{ ...ui.label, marginTop: 10 }} htmlFor="cleanerPhone">Phone number</label>
            <input
              id="cleanerPhone"
              type="tel"
              placeholder="e.g., +16265551234"
              style={ui.input}
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />

            <div style={{ ...ui.row, marginTop: 12 }}>
              <button type="submit" disabled={sending} style={ui.btnPrimary}>
                {sending ? 'Sending…' : 'Send SMS invite'}
              </button>
              <button type="button" onClick={() => router.push(`/properties/${property.id}/template`)} style={ui.btnSecondary}>
                Back to template
              </button>
              <button type="button" onClick={() => router.push('/dashboard')} style={ui.btnSecondary}>
                Dashboard
              </button>
            </div>
          </form>

          {msg && (
            <div style={{ marginTop: 10, color: msg.includes('✅') ? '#22c55e' : '#fca5a5' }}>
              {msg}
            </div>
          )}

          <div style={{ ...ui.subtle, marginTop: 12 }}>
            Tip: For testing on a Twilio trial, messages can only go to verified numbers and must be short.
          </div>
        </div>
      </section>
    </ChromeDark>
  );
}
