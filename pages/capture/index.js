// pages/capture/index.js
import { useEffect, useState } from 'react';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}
const looksLikeE164 = (s) => /^\+\d{10,15}$/.test(normalizePhone(s));

export default function CaptureLanding() {
  const [step, setStep] = useState('phone'); // 'phone' | 'otp' | 'choose' | 'starting'
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [cleaner, setCleaner] = useState(null);
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState('');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('turnqa_cleaner_phone');
    if (saved) {
      setPhone(saved);
      fetchProperties(saved);
    }
  }, []);

  async function sendOtp() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/sms/otp-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizePhone(phone) })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not send code');
      setStep('otp');
      setMsg('Code sent. Check your SMS.');
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function verifyOtp() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/sms/otp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizePhone(phone), code: code.trim() })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Invalid code');
      localStorage.setItem('turnqa_cleaner_phone', normalizePhone(phone));
      await fetchProperties(phone);
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function fetchProperties(p) {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/cleaner/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizePhone(p) })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load properties');
      setCleaner(j.cleaner);
      setProperties(j.properties || []);
      setPropertyId(j.properties?.[0]?.id || '');
      setStep('choose');
    } catch (e) {
      setMsg(e.message);
      setStep('phone');
    } finally { setBusy(false); }
  }

  async function startTurn() {
    if (!propertyId || !cleaner?.id) return;
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/cleaner/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaner_id: cleaner.id, property_id: propertyId, notes: notes || '' })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start turn');
      setStep('starting');
      window.location.href = `/turns/${j.turn_id}/capture`;
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  // styles for disabled vs enabled button (better contrast)
  const phoneValid = looksLikeE164(phone);
  const btnDisabledStyle = {
    ...ui.buttonPrimary,
    background: '#1f2937',
    color: '#cbd5e1',
    border: '1px solid #334155',
    opacity: 1,
    cursor: 'not-allowed'
  };

  return (
    // keep a single title – ChromeDark renders it, so we don't render our own <h1>
    <ChromeDark title="Start a Turn">
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {msg && <div style={{ ...ui.noteError, marginTop: 8 }}>{msg}</div>}

        {/* PHONE STEP */}
        {step === 'phone' && (
          <div style={{ ...ui.card, marginTop: 16 }}>
            <div style={ui.textMuted}>Enter your phone to get a verification code.</div>
            <input
              style={{ ...ui.input, marginTop: 10 }}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+15551234567"
              inputMode="tel"
            />
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
              Tip: include the country code, e.g. <b>+1</b> for US/Canada.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button
                onClick={sendOtp}
                disabled={busy || !phoneValid}
                style={busy || !phoneValid ? btnDisabledStyle : ui.buttonPrimary}
              >
                {busy ? 'Sending…' : 'Text me a code'}
              </button>
            </div>
          </div>
        )}

        {/* OTP STEP */}
        {step === 'otp' && (
          <div style={{ ...ui.card, marginTop: 16 }}>
            <div style={ui.textMuted}>
              Enter the 6-digit code sent to <b>{normalizePhone(phone)}</b>.
            </div>
            <input
              style={{ ...ui.input, marginTop: 10, letterSpacing: 3 }}
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="123456"
              maxLength={6}
              inputMode="numeric"
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button
                onClick={verifyOtp}
                disabled={busy || code.trim().length < 4}
                style={busy || code.trim().length < 4 ? btnDisabledStyle : ui.buttonSuccess}
              >
                {busy ? 'Verifying…' : 'Verify & continue'}
              </button>
            </div>
          </div>
        )}

        {/* CHOOSE PROPERTY */}
        {step === 'choose' && (
          <div style={{ ...ui.card, marginTop: 16 }}>
            <div style={ui.textMuted}>
              Welcome{cleaner?.name ? `, ${cleaner.name}` : ''}! Choose a property to start.
            </div>

            {properties.length === 0 ? (
              <div style={{ ...ui.noteWarn, marginTop: 10 }}>
                No properties assigned. Ask your manager to add you.
              </div>
            ) : (
              <>
                <select
                  style={{ ...ui.input, marginTop: 10 }}
                  value={propertyId}
                  onChange={e => setPropertyId(e.target.value)}
                >
                  {properties.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>

                <textarea
                  style={{ ...ui.input, height: 100, marginTop: 10 }}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Any special notes (optional)"
                />

                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <button
                    onClick={startTurn}
                    disabled={busy || !propertyId}
                    style={busy || !propertyId ? btnDisabledStyle : ui.buttonPrimary}
                  >
                    {busy ? 'Starting…' : 'Start capture'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'starting' && (
          <div style={{ ...ui.card, marginTop: 16 }}>
            <div style={ui.textMuted}>Creating your turn…</div>
          </div>
        )}
      </div>
    </ChromeDark>
  );
}
