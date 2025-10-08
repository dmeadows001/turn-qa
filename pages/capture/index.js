// pages/capture/index.js
import { useEffect, useState } from 'react';
import ChromeDark from '@/components/ChromeDark';
import ResendOtpButton from '@/components/ResendOtpButton';
import { ui } from '@/lib/theme';

function e164(s='') {
  const d = String(s||'').replace(/[^\d+]/g,'');
  if (!d) return '';
  if (d.startsWith('+')) return d;
  if (/^\d{10}$/.test(d)) return `+1${d}`; // naive US default
  return `+${d}`;
}

export default function Capture() {
  // phase: checking → verify (OTP) OR start (property picker)
  const [phase, setPhase] = useState('checking');
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  // verify form
  const [phone, setPhone] = useState('');
  const [code, setCode]   = useState('');

  // start-turn form
  const [propsLoading, setPropsLoading] = useState(false);
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState('');

  // --------------------------------------------------------------
  // 1) Check existing cleaner session
  // --------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/me/cleaner');
        if (r.status === 401) { setPhase('verify'); return; }
        const j = await r.json();
        if (!j?.cleaner?.phone) { setPhase('verify'); return; }

        // Load properties for this phone
        const p = await fetch('/api/cleaner/properties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: j.cleaner.phone }),
        }).then(x => x.json());
        setProperties(p.properties || []);
        if ((p.properties || []).length) setPropertyId(p.properties[0].id);
        setPhase('start');
      } catch {
        setPhase('verify');
      }
    })();
  }, []);

  // --------------------------------------------------------------
  // 2) Send OTP
  // --------------------------------------------------------------
  async function sendCode() {
    setMsg(null);
    setLoading(true);
    try {
      const r = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'cleaner', phone: e164(phone), consent: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not send code');
      setMsg('Code sent! Check your texts.');
    } catch (e) {
      setMsg(e.message || 'Send failed');
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------------------
  // 3) Verify OTP → cookie set server side → reload
  // --------------------------------------------------------------
  async function verifyCode() {
    setMsg(null);
    setLoading(true);
    try {
      const r = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'cleaner', phone: e164(phone), code }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Verify failed');
      window.location.href = '/capture'; // pick up session on reload
    } catch (e) {
      setMsg(e.message || 'Verify failed');
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------------------
  // 4) Start turn
  // --------------------------------------------------------------
  async function startTurn() {
    if (!propertyId) return;
    setPropsLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/cleaner/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId }), // cleaner is read from session server-side
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'start failed');
      if (!j.turn_id) throw new Error('No turn id returned');
      window.location.href = `/turns/${j.turn_id}/capture`;
    } catch (e) {
      setMsg(e.message || 'Start failed');
    } finally {
      setPropsLoading(false);
    }
  }

  // --------------------------------------------------------------
  // UI helpers (phone-friendly layout)
  // --------------------------------------------------------------
  const card = (children) => (
    <div
      style={{
        ...ui.card,
        maxWidth: 420,
        width: '100%',
        margin: '0 auto'
      }}
    >
      {children}
    </div>
  );

  const SelectWithChevron = ({ value, onChange, children }) => (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={onChange}
        style={{
          ...ui.input,
          appearance: 'none',
          paddingRight: 36,
        }}
      >
        {children}
      </select>
      {/* chevron */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '8px solid #94a3b8',
          pointerEvents: 'none',
        }}
      />
    </div>
  );

  // --------------------------------------------------------------
  // Render
  // --------------------------------------------------------------
  if (phase === 'checking') {
    return (
      <ChromeDark title="Capture" max={520}>
        <section style={ui.sectionGrid}>{card('Loading…')}</section>
      </ChromeDark>
    );
  }

  if (phase === 'verify') {
    return (
      <ChromeDark title="Capture" max={520}>
        <section style={ui.sectionGrid}>
          {card(
            <>
              <h2 style={{ marginTop: 0 }}>Verify your phone</h2>

              <label style={ui.label}>Phone</label>
              <input
                style={ui.input}
                placeholder="+1 555 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <button style={ui.btnPrimary} onClick={sendCode} disabled={loading}>
                  {loading ? 'Sending…' : 'Text me a code'}
                </button>
                {!!phone && <ResendOtpButton phone={e164(phone)} role="cleaner" />}
              </div>

              <div style={{ height: 12 }} />

              <label style={ui.label}>Enter 6-digit code</label>
              <input
                style={ui.input}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                inputMode="numeric"
                pattern="\d*"
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button style={ui.btnSecondary} onClick={verifyCode} disabled={loading}>
                  {loading ? 'Verifying…' : 'Verify'}
                </button>
              </div>

              {msg && <div style={{ marginTop: 10 }}>{msg}</div>}
            </>
          )}
        </section>
      </ChromeDark>
    );
  }

  // phase === 'start'
  return (
    <ChromeDark title="Capture" max={520}>
      <section style={ui.sectionGrid}>
        {card(
          <>
            <h2 style={{ marginTop: 0 }}>Start turn</h2>

            <label style={ui.label}>Choose a property</label>
            <SelectWithChevron value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </SelectWithChevron>

            <div style={{ marginTop: 12 }}>
              <button
                style={ui.btnPrimary}
                onClick={startTurn}
                disabled={propsLoading || !propertyId}
              >
                {propsLoading ? 'Starting…' : 'Start turn'}
              </button>
            </div>

            {msg && <div style={{ marginTop: 10, color: '#ef4444' }}>{msg}</div>}
          </>
        )}
      </section>
    </ChromeDark>
  );
}
