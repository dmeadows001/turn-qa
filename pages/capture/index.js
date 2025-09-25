// pages/capture/index.js
import { useEffect, useMemo, useState } from 'react';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

// ---------- small helpers ----------
function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  return digits.startsWith('+') ? digits : `+${digits}`;
}
function maskPhone(p) {
  if (!p || p.length < 4) return p || '';
  const last4 = p.slice(-4);
  return `•• •• •• ${last4}`;
}

// Try a few endpoints so we’re resilient to naming
async function fetchCleanerProperties(phone) {
  const qs = `?phone=${encodeURIComponent(phone)}`;
  const candidates = [
    `/api/cleaner/properties${qs}`,
    `/api/properties-for-cleaner${qs}`,
    `/api/capture/properties${qs}`,
    `/api/cleaner/props${qs}`,
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      // Accept a few shapes:
      if (Array.isArray(j.properties)) return j.properties;
      if (Array.isArray(j.props)) return j.props;
      if (Array.isArray(j.data)) return j.data;
      if (Array.isArray(j)) return j;
    } catch {}
  }
  return [];
}

// Create a turn; accept multiple shapes
async function createTurn({ phone, property_id, notes }) {
  const body = { phone, property_id, notes: notes || '' };
  const endpoints = ['/api/start-turn', '/api/turns/start', '/api/turn/start'];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) continue;
      const id = j.turn_id || j.id || j.turn?.id;
      if (id) return String(id);
    } catch {}
  }
  throw new Error('Could not start a turn.');
}

export default function CaptureLanding() {
  // Step 0: phone (pulled from localStorage if present)
  const [phoneInput, setPhoneInput] = useState('');
  const [knownPhone, setKnownPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [busySend, setBusySend] = useState(false);
  const [busyVerify, setBusyVerify] = useState(false);

  // Step 1: properties
  const [loadingProps, setLoadingProps] = useState(false);
  const [propsList, setPropsList] = useState([]);
  const [propId, setPropId] = useState('');
  const [notes, setNotes] = useState('');

  // UX
  const [err, setErr] = useState('');
  const [starting, setStarting] = useState(false);

  // restore cached phone (from onboarding or previous visits)
  useEffect(() => {
    try {
      const cached = localStorage.getItem('turnqa_cleaner_phone');
      if (cached) {
        setKnownPhone(cached);
        setPhoneInput(cached);
      }
    } catch {}
  }, []);

  const effectivePhone = useMemo(() => {
    return normalizePhone(knownPhone || phoneInput);
  }, [knownPhone, phoneInput]);

  // when we have a known phone, fetch properties
  useEffect(() => {
    if (!effectivePhone) return;
    (async () => {
      setErr('');
      setLoadingProps(true);
      try {
        const props = await fetchCleanerProperties(effectivePhone);
        setPropsList(props || []);
        // preselect if only one
        if ((props || []).length === 1) {
          const only = props[0];
          setPropId(only?.id || only?.property_id || '');
        }
      } catch (e) {
        setErr(e.message || 'Could not load your properties.');
      } finally {
        setLoadingProps(false);
      }
    })();
  }, [effectivePhone]);

  // ------------- OTP flow (only if no known phone) -------------
  async function sendCode(e) {
    e?.preventDefault?.();
    setErr('');
    if (!phoneInput) return setErr('Enter your mobile number.');
    try {
      setBusySend(true);
      const r = await fetch('/api/sms/otp-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizePhone(phoneInput), purpose: 'capture_login' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send code.');
      setOtpSent(true);
    } catch (e) {
      setErr(e.message || 'Could not send code.');
    } finally {
      setBusySend(false);
    }
  }

  async function verifyCode(e) {
    e?.preventDefault?.();
    setErr('');
    if (!otpCode || otpCode.length < 4) return setErr('Enter the 6-digit code.');
    try {
      setBusyVerify(true);
      const r = await fetch('/api/sms/otp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizePhone(phoneInput), code: otpCode, purpose: 'capture_login' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not verify code.');
      // success: cache & promote to known phone
      const normalized = normalizePhone(phoneInput);
      try { localStorage.setItem('turnqa_cleaner_phone', normalized); } catch {}
      setKnownPhone(normalized);
      setOtpSent(false);
      setOtpCode('');
    } catch (e) {
      setErr(e.message || 'Could not verify code.');
    } finally {
      setBusyVerify(false);
    }
  }

  // ------------- Start capture -------------
  async function startCapture(e) {
    e?.preventDefault?.();
    setErr('');
    if (!effectivePhone) return setErr('Missing phone.');
    if (!propId) return setErr('Select a property to continue.');
    try {
      setStarting(true);
      const id = await createTurn({ phone: effectivePhone, property_id: propId, notes });
      window.location.href = `/turns/${id}/capture`;
    } catch (e) {
      setErr(e.message || 'Could not start a turn.');
    } finally {
      setStarting(false);
    }
  }

  // ------------------- UI -------------------
  // We set title on the Chrome so we don’t double-render a second H1.
  return (
    <ChromeDark title="Start a Turn">
      <div style={{ ...ui.card, maxWidth: 860 }}>
        {/* PHONE / OTP */}
        {!effectivePhone ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>
              Enter your phone to get a verification code.
            </div>

            <div style={{ marginTop: 10 }}>
              <input
                value={phoneInput}
                onChange={e => setPhoneInput(e.target.value)}
                placeholder="+15551234567"
                inputMode="tel"
                style={{ ...ui.input }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button onClick={sendCode} disabled={busySend || !phoneInput} style={ui.buttonPrimary}>
                {busySend ? 'Sending…' : 'Text me a code'}
              </button>
              {otpSent && <div style={{ alignSelf: 'center', color:'#9ca3af', fontSize: 13 }}>Code sent. Check your SMS.</div>}
            </div>

            {otpSent && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>Enter the 6-digit code</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value)}
                    placeholder="123456"
                    inputMode="numeric"
                    maxLength={6}
                    style={{ ...ui.input, width: 200 }}
                  />
                  <button onClick={verifyCode} disabled={busyVerify || !otpCode} style={ui.buttonSecondary}>
                    {busyVerify ? 'Verifying…' : 'Verify'}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* KNOWN PHONE HEADER */}
            <div style={{ color:'#cbd5e1' }}>
              Signed in as <b>{maskPhone(effectivePhone)}</b>
              <button
                onClick={() => { try { localStorage.removeItem('turnqa_cleaner_phone'); } catch {} ; setKnownPhone(''); }}
                style={{ marginLeft: 10, ...ui.linkButton }}
                aria-label="Use a different phone"
              >
                use different phone
              </button>
            </div>

            {/* PROPERTIES */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color:'#94a3b8', marginBottom: 6 }}>Select the property</div>
              {loadingProps ? (
                <div style={{ color:'#9ca3af' }}>Loading your properties…</div>
              ) : propsList.length === 0 ? (
                <div style={{ color:'#fca5a5' }}>
                  We couldn’t find any properties for your phone. Ask your manager to assign you, or paste the property ID:
                  <input
                    value={propId}
                    onChange={e=>setPropId(e.target.value)}
                    placeholder="property-id"
                    style={{ ...ui.input, marginTop: 8 }}
                  />
                </div>
              ) : (
                <select
                  value={propId}
                  onChange={e => setPropId(e.target.value)}
                  style={{ ...ui.input }}
                >
                  <option value="">— Select —</option>
                  {propsList.map(p => {
                    const id = p.id || p.property_id;
                    const name = p.name || p.property_name || id;
                    return <option key={id} value={id}>{name}</option>;
                  })}
                </select>
              )}
            </div>

            {/* OPTIONAL NOTES */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color:'#94a3b8', marginBottom: 6 }}>
                Notes (optional — e.g., “extra attention to patio”)
              </div>
              <textarea
                value={notes}
                onChange={e=>setNotes(e.target.value)}
                rows={3}
                style={{ ...ui.textarea }}
              />
            </div>

            {/* ACTIONS */}
            <div style={{ display:'flex', gap:10, marginTop: 16, flexWrap:'wrap' }}>
              <button
                onClick={startCapture}
                disabled={starting || !propId}
                style={ui.buttonPrimary}
              >
                {starting ? 'Starting…' : 'Start capture'}
              </button>
              <a href="/" style={{ ...ui.buttonLink }}>Back home</a>
            </div>
          </>
        )}

        {err && <div style={{ marginTop: 12, color:'#fca5a5' }}>{err}</div>}
      </div>
    </ChromeDark>
  );
}
