// pages/onboard/cleaner.js
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

// ------- helpers -------
function maskPhone(p) {
  if (!p || p.length < 4) return p || '';
  const last4 = p.slice(-4);
  return `•• •• •• ${last4}`;
}
function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  return digits.startsWith('+') ? digits : `+${digits}`;
}

// Hit whatever invite-info endpoint you already have.
// We try a few names to be resilient.
async function resolveInvite(inviteId) {
  const paths = [
    `/api/invite/cleaner-info?id=${inviteId}`,
    `/api/invite/info?id=${inviteId}`,
    `/api/invite/lookup?id=${inviteId}`,
  ];
  for (const p of paths) {
    try {
      const r = await fetch(p);
      if (!r.ok) continue;
      const j = await r.json();
      // Accept a few shapes:
      if (j.invite || j.property || j.ok) return j;
    } catch {}
  }
  return {};
}

export default function CleanerOnboarding() {
  const router = useRouter();
  const inviteId = router.query?.id;

  // Invite / property data
  const [loading, setLoading] = useState(true);
  const [invite, setInvite]   = useState(null); // { id, name, phone, property_id }
  const [property, setProperty] = useState(null); // { id, name }

  // OTP flow
  const [phone, setPhone]     = useState('');    // used if invite has no phone
  const [code, setCode]       = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent]       = useState(false);
  const [ok, setOk]           = useState(false);
  const [err, setErr]         = useState('');

  const effectivePhone = useMemo(() => {
    // Prefer invite's phone; fall back to the input field
    return normalizePhone(invite?.phone || phone);
  }, [invite?.phone, phone]);

  useEffect(() => {
    if (!inviteId) return;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const j = await resolveInvite(inviteId);

        // Heuristics to map shapes
        // Preferred: { invite: {...}, property: {...} }
        let inv = j.invite || j.data || j.cleanerInvite || null;
        let prop = j.property || j.prop || null;

        // If the endpoint returned a flat object, accept it too
        if (!inv && (j.id || j.phone || j.property_id)) inv = j;

        setInvite(inv || null);
        setProperty(prop || null);

        // Pre-fill the phone input if the invite didn’t have it but localStorage does
        if (!inv?.phone) {
          try {
            const cached = localStorage.getItem('turnqa_cleaner_phone');
            if (cached) setPhone(cached);
          } catch {}
        }
      } catch (e) {
        setErr(e.message || 'Could not load invite.');
      } finally {
        setLoading(false);
      }
    })();
  }, [inviteId]);

  async function sendCode(e) {
    e?.preventDefault?.();
    setErr('');
    setSent(false);
    if (!effectivePhone) return setErr('Enter a phone number.');
    try {
      setSending(true);
      const r = await fetch('/api/sms/otp-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: effectivePhone,
          invite_id: inviteId || null,
          purpose: 'cleaner_onboard',
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send code.');
      setSent(true);
    } catch (e) {
      setErr(e.message || 'Could not send code.');
    } finally {
      setSending(false);
    }
  }

  async function verifyCode(e) {
    e?.preventDefault?.();
    setErr('');
    if (!effectivePhone) return setErr('Enter a phone number.');
    if (!code || code.length < 4) return setErr('Enter the 6-digit code.');
    try {
      setVerifying(true);
      const r = await fetch('/api/sms/otp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: effectivePhone,
          code,
          invite_id: inviteId || null,
          purpose: 'cleaner_onboard',
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not verify code.');

      // success
      setOk(true);
      try {
        localStorage.setItem('turnqa_cleaner_phone', effectivePhone);
      } catch {}

      // Optional: auto-redirect after a few seconds
      // const t = setTimeout(() => {
      //   const pid = invite?.property_id || '';
      //   window.location.href = `/capture?pid=${pid}&from=onboard`;
      // }, 3500);
      // return () => clearTimeout(t);
    } catch (e) {
      setErr(e.message || 'Could not verify code.');
    } finally {
      setVerifying(false);
    }
  }

  // ---------------- UI ----------------
  return (
    <ChromeDark title="Cleaner Onboarding">
      <div style={{ ...ui.card, maxWidth: 760, marginTop: 8 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>
          Welcome{invite?.name ? `, ${invite.name}` : ''} <span role="img" aria-label="wave">👋</span>
        </div>

        {property?.name && (
          <div style={{ marginTop: 10, color: '#cbd5e1' }}>
            You’ve been invited to clean: <b>{property.name}</b>
          </div>
        )}

        {/* Phone line */}
        <div style={{ marginTop: 12, color: '#cbd5e1' }}>
          We’ll text important updates to:&nbsp;
          <b>{invite?.phone ? maskPhone(invite.phone) : (effectivePhone ? maskPhone(effectivePhone) : '—')}</b>
        </div>

        {/* Success state */}
        {ok ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ padding: 10, borderRadius: 10, background: '#052e1f', color: '#d1fae5', border: '1px solid #065f46' }}>
              ✅ Phone verified. You’re good to go!
            </div>

            <div style={{ marginTop: 12, color: '#cbd5e1' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>What happens next?</div>
              <ol style={{ marginLeft: 18 }}>
                <li>Go to <b>Start a Turn</b>.</li>
                <li>Select the property you’re cleaning.</li>
                <li>Take the required photos, run AI pre-check, then submit for review.</li>
              </ol>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <a
                href={`/capture?pid=${invite?.property_id || ''}&from=onboard`}
                style={{ ...ui.buttonPrimary, textDecoration: 'none' }}
              >
                ▶ Start a Turn now
              </a>
              <a href="/" style={{ color:'#93c5fd', textDecoration:'underline', alignSelf:'center' }}>
                Back home
              </a>
            </div>
          </div>
        ) : (
          <>
            {/* If invite didn't have a phone, show an input to collect it */}
            {!invite?.phone && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>Your mobile number</div>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+15551234567"
                  inputMode="tel"
                  style={{ ...ui.input }}
                />
              </div>
            )}

            {/* Send code */}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap:'wrap' }}>
              <button
                onClick={sendCode}
                disabled={sending || !effectivePhone}
                style={ui.buttonSecondary}
              >
                {sending ? 'Sending…' : 'Text me a code'}
              </button>

              {sent && (
                <div style={{ alignSelf: 'center', color: '#9ca3af', fontSize: 13 }}>
                  Code sent. Please check your SMS.
                </div>
              )}
            </div>

            {/* Verify code */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>Enter the 6-digit code</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap:'wrap' }}>
                <input
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  style={{ ...ui.input, width: 200 }}
                  maxLength={6}
                />
                <button
                  onClick={verifyCode}
                  disabled={verifying || !code || !effectivePhone}
                  style={ui.buttonPrimary}
                >
                  {verifying ? 'Verifying…' : 'Verify & finish'}
                </button>
              </div>
            </div>

            {err && (
              <div style={{ marginTop: 12, color: '#fca5a5' }}>
                {err}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <a href="/" style={{ color:'#93c5fd', textDecoration:'underline' }}>← Back home</a>
            </div>
          </>
        )}
      </div>
    </ChromeDark>
  );
}
