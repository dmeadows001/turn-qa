// pages/capture/index.js
import { useEffect, useMemo, useState } from 'react';
import ChromeDark from '@/components/ChromeDark';
import ResendOtpButton from '@/components/ResendOtpButton';
import { ui } from '@/lib/theme';

const SHELL_MAX = 420;

function e164(s = '') {
  const d = String(s || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d;
  if (/^\d{10}$/.test(d)) return `+1${d}`;
  return `+${d}`;
}

// Normalize URL tab -> our internal keys
function normalizeTabParam(v = '') {
  const t = String(v || '').toLowerCase();
  if (t === 'needs-fix' || t === 'needs_fix' || t === 'fix') return 'fix';
  if (t === 'start') return 'start';
  return '';
}

// Reusable card at file scope so VerifyForm can use it
function Card({ children }) {
  return <div style={{ ...ui.card, width: '100%' }}>{children}</div>;
}

export default function Capture() {
  // phase: checking → verify | start
  const [phase, setPhase] = useState('checking');
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  // verify
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  // start-turn
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState('');
  const [propsLoading, setPropsLoading] = useState(false);

  // needs-fix
  const [fixTurns, setFixTurns] = useState([]);

  // Read deep-link params once on mount (no SSR)
  const { tabParam, turnParam } = useMemo(() => {
    if (typeof window === 'undefined') return { tabParam: '', turnParam: '' };
    const qs = new URLSearchParams(window.location.search);
    return {
      tabParam: normalizeTabParam(qs.get('tab') || ''),
      turnParam: (qs.get('turn') || '').trim(),
    };
  }, []);

  const [activeTab, setActiveTab] = useState(tabParam || 'fix'); // default to fix

   // If a specific turn is provided (?turn=...), route directly to the correct capture view.
  // - in_progress  -> /turns/:id/capture?from=capture      (initial capture)
  // - needs_fix    -> /turns/:id/capture?tab=needs-fix     (fix flow)
  useEffect(() => {
    if (!turnParam) return;
    (async () => {
      try {
        const r = await fetch(`/api/get-turn?id=${encodeURIComponent(turnParam)}`);
        const j = await r.json().catch(() => ({}));
        const t = j?.turn;
        if (!t) return;
        if (t.status === 'in_progress') {
          window.location.replace(`/turns/${turnParam}/capture?from=capture`);
          return;
        }
        if (t.status === 'needs_fix') {
          window.location.replace(`/turns/${turnParam}/capture?tab=needs-fix`);
          return;
        }
      } catch {}
    })();
  }, [turnParam]);

  // ------------------------------------------------------------------
  // 1) Check cookie; if logged in as cleaner, preload properties + needs_fix
  // ------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/me/cleaner');
        if (r.status === 401) {
          setPhase('verify');
          return;
        }
        const j = await r.json();
        if (!j?.cleaner?.phone) {
          setPhase('verify');
          return;
        }

        // Load properties
        const p = await fetch('/api/cleaner/properties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: j.cleaner.phone }),
        }).then((x) => x.json());
        const props = p.properties || [];
        setProperties(props);
        if (props.length) setPropertyId(props[0].id);

        // Load turns needing attention
        const fx = await fetch('/api/cleaner/turns?status=needs_fix')
          .then((r) => r.json())
          .catch(() => ({ rows: [] }));
        const rows = Array.isArray(fx?.rows) ? fx.rows : [];
        setFixTurns(rows);

        // Decide initial tab
        if (tabParam) {
          setActiveTab(tabParam); // already normalized
        } else if (rows.length) {
          setActiveTab('fix');
        } else {
          setActiveTab('start');
        }

        setPhase('start');
      } catch {
        setPhase('verify');
      }
    })();
  }, [tabParam]);

  // ------------------------------------------------------------------
  // 2) Verify: send + verify code
  // ------------------------------------------------------------------
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
      window.location.href = '/capture?tab=start';
    } catch (e) {
      setMsg(e.message || 'Verify failed');
    } finally {
      setLoading(false);
    }
  }

  // ------------------------------------------------------------------
  // 3) Start turn
  // ------------------------------------------------------------------
  async function startTurn() {
    if (!propertyId) return;
    setPropsLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/cleaner/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'start failed');
      if (!j.turn_id) throw new Error('No turn id returned');
      window.location.href = `/turns/${j.turn_id}/capture?from=capture`;
    } catch (e) {
      setMsg(e.message || 'Start failed');
    } finally {
      setPropsLoading(false);
    }
  }

  // ------------------------------------------------------------------
  // UI Helpers (keep tabs + card perfectly aligned)
  // ------------------------------------------------------------------
  const shell = { maxWidth: SHELL_MAX, margin: '0 auto' };

  const Tabs = () => (
    <div
      style={{
        ...ui.tabs,
        width: '100%',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
        marginBottom: 12,
      }}
    >
      <div style={ui.tab(activeTab === 'fix')} onClick={() => setActiveTab('fix')}>
        Needs fix
      </div>
      <div style={ui.tab(activeTab === 'start')} onClick={() => setActiveTab('start')}>
        Start
      </div>
    </div>
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (phase === 'checking') {
    return (
      <ChromeDark title="Capture">
        <section style={{ ...ui.sectionGrid, ...shell }}>
          <Card>Loading…</Card>
        </section>
      </ChromeDark>
    );
  }

  if (phase === 'verify') {
    return (
      <ChromeDark title="Capture">
        <section style={{ ...ui.sectionGrid, ...shell }}>
          <VerifyForm
            phone={phone}
            code={code}
            loading={loading}
            msg={msg}
            onChangePhone={setPhone}
            onChangeCode={setCode}
            onSend={sendCode}
            onVerify={verifyCode}
          />
        </section>
      </ChromeDark>
    );
  }

  // phase === 'start'
  return (
    <ChromeDark title="Capture">
      <section style={{ ...ui.sectionGrid, ...shell }}>
        {/* Tabs + Card share the SAME wrapper width */}
        <Tabs />

        {/* Needs fix panel */}
        {activeTab === 'fix' && (
          <Card>
            <h2 style={{ marginTop: 0 }}>Needs fix</h2>
            {!fixTurns.length ? (
              <div style={ui.subtle}>Nothing to fix right now.</div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {fixTurns.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      border: '1px solid #334155',
                      borderRadius: 12,
                      padding: 12,
                      background: '#0b1220',
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        {t.property_name || 'Property'}
                      </div>
                      <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.35 }}>
                        Turn <code>{t.id.slice(0, 8)}</code> &middot; status: {t.status}
                      </div>
                    </div>
                    <a
                      href={`/turns/${t.id}/capture?tab=needs-fix`}
                      style={{ ...ui.btnPrimary, display: 'inline-block' }}
                    >
                      Resume
                    </a>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Start turn panel */}
        {activeTab === 'start' && (
          <Card>
            <h2 style={{ marginTop: 0 }}>Start turn</h2>

            <label style={ui.label}>Choose a property</label>
            <div style={{ position: 'relative' }}>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                style={{ ...ui.input, appearance: 'none', paddingRight: 34 }}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {/* Chevron */}
              <div
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

            <div style={{ marginTop: 12 }}>
              <button style={ui.btnPrimary} onClick={startTurn} disabled={propsLoading || !propertyId}>
                {propsLoading ? 'Starting…' : 'Start turn'}
              </button>
            </div>

            {msg && <div style={{ marginTop: 10, color: '#ef4444' }}>{msg}</div>}
          </Card>
        )}
      </section>
    </ChromeDark>
  );
}

/* ---------- Stable Verify form (prevents remounts/blur on each keystroke) ---------- */
function VerifyForm({ phone, code, loading, msg, onChangePhone, onChangeCode, onSend, onVerify }) {
  function noSubmit(e) {
    e.preventDefault(); // avoid implicit submit that can blur inputs
  }

  // Keep the Resend button mounted; just toggle visibility/disabled
  const showResend = !!phone && phone.replace(/[^\d]/g, '').length >= 7;

  return (
    <Card>
      <form onSubmit={noSubmit}>
        <h2 style={{ marginTop: 0 }}>Verify your phone</h2>

        <label style={ui.label} htmlFor="phone">Phone</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            style={{ ...ui.input, flex: 1 }}
            placeholder="+1 555 123 4567"
            value={phone}
            onChange={(e) => onChangePhone(e.target.value)}
          />
          <div style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
            <div style={{ visibility: showResend ? 'visible' : 'hidden' }}>
              <ResendOtpButton phone={e164(phone)} role="cleaner" />
            </div>
          </div>
        </div>

        <div style={{ height: 10 }} />

        <label style={ui.label} htmlFor="code">Enter 6-digit code</label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          style={ui.input}
          placeholder="123456"
          value={code}
          onChange={(e) => onChangeCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button type="button" style={ui.btnPrimary} onClick={onSend} disabled={loading}>
            {loading ? 'Sending…' : 'Text me a code'}
          </button>
          <button
            type="button"
            style={ui.btnSecondary}
            onClick={onVerify}
            disabled={loading || code.length < 6}
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </div>

        {msg && <div style={{ marginTop: 10 }}>{msg}</div>}
      </form>
    </Card>
  );
}
