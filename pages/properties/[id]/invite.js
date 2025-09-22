// pages/properties/[id]/invite.js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import ChromeDark from '../../../components/ChromeDark';

export default function InviteCleaner() {
  const router = useRouter();
  const { id: propertyId } = router.query;

  const [propertyName, setPropertyName] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      try {
        setMsg('Loading…');
        const r = await fetch(`/api/property-name?id=${propertyId}`);
        const j = await r.json();
        setPropertyName(j.name || '');
        setMsg('');
      } catch {
        setMsg('Could not load property');
      }
    })();
  }, [propertyId]);

  async function sendInvite() {
    try {
      setMsg('');
      if (!phone.trim()) throw new Error('Enter a phone number.');
      setSending(true);

      const r = await fetch('/api/invite/cleaner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          phone,
          name: name || null
        })
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Invite failed');

      setMsg(`Invite sent to ${phone}. Onboarding link: ${j.invite_url}`);
    } catch (e) {
      setMsg(`Invite failed: ${e.message || e}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <ChromeDark title={`Invite Cleaner — ${propertyName || ''}`}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ border:'1px solid #1f2937', background:'#0b1220', borderRadius:16, padding:18 }}>
          <div style={{ color:'#cbd5e1', marginBottom:8 }}>
            We’ll text them a secure link to verify consent and access the photo capture page.
          </div>

          <div style={{ fontSize:12, color:'#94a3b8', marginTop:10, marginBottom:6 }}>Cleaner name</div>
          <input
            value={name}
            onChange={e=>setName(e.target.value)}
            placeholder="e.g., Sam Rivera"
            style={{ width:'100%', padding:10, borderRadius:10, border:'1px solid #334155', background:'#0f172a', color:'#e2e8f0' }}
          />

          <div style={{ fontSize:12, color:'#94a3b8', marginTop:12, marginBottom:6 }}>Phone number</div>
          <input
            value={phone}
            onChange={e=>setPhone(e.target.value)}
            placeholder="+15551234567"
            style={{ width:'100%', padding:10, borderRadius:10, border:'1px solid #334155', background:'#0f172a', color:'#e2e8f0' }}
          />

          <div style={{ marginTop:14 }}>
            <button
              onClick={sendInvite}
              disabled={sending || !propertyId}
              style={{
                padding:'10px 14px', borderRadius:10,
                border:'1px solid #22c55e', background:'#052e1c',
                color:'#bbf7d0', cursor:'pointer'
              }}
            >
              {sending ? 'Sending…' : 'Send SMS invite'}
            </button>
          </div>

          <div style={{ marginTop:12 }}>
            <a href={`/properties/${propertyId}/template`} style={{ color:'#93c5fd' }}>← Back to template</a>
            {' · '}
            <a href="/dashboard" style={{ color:'#93c5fd' }}>Dashboard</a>
          </div>

          {msg && <div style={{ marginTop:10, color: msg.startsWith('Invite failed') ? '#fecaca' : '#bbf7d0' }}>{msg}</div>}

          <div style={{ marginTop:12, color:'#94a3b8', fontSize:12 }}>
            Tip: On a Twilio trial, messages can only go to verified numbers and must be short.
          </div>
        </div>
      </div>
    </ChromeDark>
  );
}
