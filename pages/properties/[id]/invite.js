// pages/properties/[id]/invite.js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import ChromeDark from '../../../components/ChromeDark';
import { supabaseBrowser } from '../../../lib/supabaseBrowser';

const supabase = supabaseBrowser();

export default function InviteCleaner() {
  const router = useRouter();
  const { id: propertyId } = router.query;

  const [propertyName, setPropertyName] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
    // Verify subscription before allowing access to Invite Cleaner.
  const [subscriptionAccess, setSubscriptionAccess] = useState('checking');
  const [subscriptionError, setSubscriptionError] = useState('');
  const [subscriptionRetry, setSubscriptionRetry] = useState(0);

  useEffect(() => {
    if (!router.isReady) return;

    let cancelled = false;

    setSubscriptionAccess('checking');
    setSubscriptionError('');
    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (cancelled) return;
        if (error) throw error;

        const token = data?.session?.access_token;

        if (!token) {
          router.replace('/login');
          return;
        }

        const response = await fetch('/api/billing/status', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
          cache: 'no-store',
        });

        if (cancelled) return;

        if (response.status === 401) {
          router.replace('/login');
          return;
        }

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            result.error || `Subscription check failed (${response.status})`
          );
        }

        if (result.allowed !== true) {
          router.replace('/billing?reason=expired');
          return;
        }

        setSubscriptionAccess('allowed');
      } catch (error) {
        if (cancelled) return;

        console.error('[invite subscription check]', error);

        setSubscriptionError(
          error?.message || 'Unable to verify subscription.'
        );

        setSubscriptionAccess('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router.isReady, subscriptionRetry, router]);

  useEffect(() => {
    if (!propertyId || subscriptionAccess !== 'allowed') return;
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
  }, [propertyId, subscriptionAccess]);

    async function sendInvite() {
    try {
      setMsg('');

      // Do not send invitations unless subscription access is verified.
      if (subscriptionAccess !== 'allowed') {
        throw new Error('An active subscription is required to invite cleaners.');
      }

      if (!phone.trim()) throw new Error('Enter a phone number.');

      // Get the current manager's authentication token.
      const { data, error } = await supabase.auth.getSession();

      if (error) throw error;

      const token = data?.session?.access_token;

      if (!token) {
        router.replace('/login');
        throw new Error('Your session has expired. Please sign in again.');
      }

      setSending(true);

      const r = await fetch('/api/invite/cleaner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          property_id: propertyId,
          phone,
          name: name || null
        })
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Invite failed');

      setMsg(
  j.sms?.ok
    ? `SMS invitation successfully sent to ${phone}.`
    : `Cleaner linked to property, but SMS could not be sent: ${j.sms?.reason || 'Unknown error'}`
);
    } catch (e) {
      setMsg(`Invite failed: ${e.message || e}`);
    } finally {
      setSending(false);
    }
  }
  // Never display Invite Cleaner before subscription verification.
  if (subscriptionAccess !== 'allowed') {
    return (
      <ChromeDark title="Invite Cleaner">
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <div
            style={{
              border: '1px solid #1f2937',
              background: '#0b1220',
              borderRadius: 16,
              padding: 18,
            }}
          >
            {subscriptionAccess === 'error' ? (
              <>
                <h2>Subscription check unavailable</h2>
                <p>
                  {subscriptionError ||
                    'We could not verify your subscription. Please try again.'}
                </p>
                <button
                  type="button"
                  onClick={() => setSubscriptionRetry((n) => n + 1)}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid #22c55e',
                    background: '#052e1c',
                    color: '#bbf7d0',
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </>
            ) : (
              <div style={{ color: '#cbd5e1' }}>
                Checking your subscription…
              </div>
            )}
          </div>
        </div>
      </ChromeDark>
    );
  }
  return (
    <ChromeDark title="Invite Cleaner">
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
                  <div
            style={{
              color: '#94a3b8',
              fontSize: 14,
              marginBottom: 12,
              textAlign: 'center',
            }}
          >
            Property: {propertyName || 'Loading…'}
          </div>
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
