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
  const [consent, setConsent] = useState(false); // <-- SMS consent
  const [codeSent, setCodeSent] = useState(false);

  // start-turn
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState('');
  const [propsLoading, setPropsLoading] = useState(false);
  const [unfinishedTurns, setUnfinishedTurns] = useState(null);
  const [discardingId, setDiscardingId] = useState(null);

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

    // Require explicit consent
    if (!consent) {
      setMsg('Please agree to receive SMS alerts before requesting a code.');
      return;
    }

    setLoading(true);
    try {
      const r = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'cleaner', phone: e164(phone), consent: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not send code');
      setCodeSent(true);
      setCode('');
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
      // Preserve a requested turn or tab after OTP authentication.
      const params = new URLSearchParams(window.location.search);
      if (!params.get('turn') && !params.get('tab')) params.set('tab', 'start');
      window.location.href = `/capture?${params.toString()}`;
    } catch (e) {
      setMsg(e.message || 'Verify failed');
    } finally {
      setLoading(false);
    }
  }

  // ------------------------------------------------------------------
  // 3) Start turn
  // ------------------------------------------------------------------
  async function requestStart(action = 'check') {
    if (!propertyId) return;
    setPropsLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/cleaner/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId, action }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not start turn');
      if (j.choice_required) {
        setUnfinishedTurns(j.unfinished || []);
        return;
      }
      if (!j.turn_id) throw new Error('No turn id returned');
      window.location.href = `/turns/${encodeURIComponent(j.turn_id)}/capture?from=capture`;
    } catch (e) {
      setMsg(e.message || 'Start failed');
    } finally {
      setPropsLoading(false);
    }
  }

  async function discardTurn(turn) {
    if (!window.confirm(`Permanently discard the unfinished cleaning started ${new Date(turn.created_at).toLocaleString()}? Its uploaded photos will be deleted. This cannot be undone.`)) return;
    setDiscardingId(turn.id);
    setMsg(null);
    try {
      const r = await fetch('/api/cleaner/discard-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turn_id: turn.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Discard failed');
      setUnfinishedTurns(prev => (prev || []).filter(t => t.id !== turn.id));
      setMsg('Unfinished cleaning discarded. You can now start a new cleaning.');
    } catch (e) {
      setMsg(e.message || 'Discard failed');
    } finally {
      setDiscardingId(null);
    }
  }

  function startTurn() {
    setUnfinishedTurns(null);
    return requestStart('check');
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
      <ChromeDark title="Welcome to TurnQA">
        <section style={{ ...ui.sectionGrid, ...shell }}>

     {/* === SMS Opt-In Branding (Twilio Compliance) === */}
        <div style={{ marginBottom: 14, textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Cleaner phone verification</h1>
          <p style={{ marginTop: 6, fontSize: 14, color: '#94a3b8' }}>
            TurnQA uses text messages to send verification codes and
            job-related updates for cleaning turns.  
            Messages are transactional only (no marketing).
          </p>
        </div>
    
          <VerifyForm
            phone={phone}
            code={code}
            consent={consent}
            loading={loading}
            msg={msg}
            codeSent={codeSent}
            onChangePhone={setPhone}
            onChangeCode={setCode}
            onToggleConsent={() => setConsent((v) => !v)}
            onSend={sendCode}
            onVerify={verifyCode}
            onChangeNumber={() => { setCodeSent(false); setCode(''); setMsg(null); }}
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
                      <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 5 }}>
                        Started: {t.created_at ? new Date(t.created_at).toLocaleString() : 'Date unavailable'}
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
                onChange={(e) => { setPropertyId(e.target.value); setUnfinishedTurns(null); setMsg(null); }}
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

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <button
                style={ui.btnPrimary}
                onClick={startTurn}
                disabled={propsLoading || !propertyId}
              >
                {propsLoading ? 'Starting…' : 'Start turn'}
              </button>

              {/* Cleaner turn history */}
              <a href="/cleaner/turns" style={ui.btnSecondary}>
                View my turns
              </a>
            </div>

            {unfinishedTurns !== null && (
              <div style={{ marginTop: 16, border: '1px solid #475569', borderRadius: 12, padding: 12 }}>
                <h3 style={{ marginTop: 0 }}>Unfinished cleaning found</h3>
                <p style={{ color: '#cbd5e1', fontSize: 14 }}>
                  This property has an unfinished cleaning under your account.
                  Choose which cleaning to continue, or start a new one.
                </p>
                {unfinishedTurns.map((t) => (
                  <div key={t.id} style={{ marginBottom: 12, display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: 13, color: '#cbd5e1' }}>
                      Started: {t.created_at ? new Date(t.created_at).toLocaleString() : 'Unknown date'}
                    </span>
                    <a
                      href={`/turns/${encodeURIComponent(t.id)}/capture?from=capture`}
                      style={{ ...ui.btnSecondary, display: 'inline-block', textAlign: 'center' }}
                    >
                      Continue this cleaning
                    </a>
                    <button
                      type="button"
                      style={{ ...ui.btnSecondary, borderColor: '#b45353', color: '#fecaca' }}
                      disabled={propsLoading || !!discardingId}
                      onClick={() => discardTurn(t)}
                    >
                      {discardingId === t.id ? 'Discarding…' : 'Discard this cleaning'}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  style={ui.btnPrimary}
                  disabled={propsLoading}
                  onClick={() => requestStart('new')}
                >
                  {propsLoading ? 'Starting…' : 'Start Fresh Cleaning'}
                </button>
                <p style={{ fontSize: 12, color: '#94a3b8' }}>
                  Starting fresh preserves older drafts. Use Discard this cleaning to remove an unwanted unfinished turn.
                </p>
              </div>
            )}
            {msg && <div style={{ marginTop: 10, color: '#ef4444' }}>{msg}</div>}
          </Card>
        )}
      </section>
    </ChromeDark>
  );
}

/* ---------- Stable Verify form (prevents remounts/blur on each keystroke) ---------- */
function VerifyForm({
  phone,
  code,
  consent,
  loading,
  msg,
  codeSent,
  onChangePhone,
  onChangeCode,
  onToggleConsent,
  onSend,
  onVerify,
  onChangeNumber,
}) {
  function noSubmit(e) {
    e.preventDefault();
    if (codeSent) {
      if (code.length === 6 && !loading) onVerify();
    } else if (!loading && consent && phone.replace(/[^\d]/g, '').length >= 10) {
      onSend();
    }
  }

  const digits = phone.replace(/[^\d]/g, '');
  const hasPhone = digits.length >= 10;

  return (
    <Card>
      <form onSubmit={noSubmit}>
        <h2 style={{ marginTop: 0 }}>
          {codeSent ? 'Enter your verification code' : 'Verify your phone'}
        </h2>
        <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
          {codeSent
            ? 'Enter the 6-digit code we just sent to your phone.'
            : 'Enter your mobile number to securely access your assigned properties.'}
        </p>

        <label style={ui.label} htmlFor="phone">Phone number</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            style={{ ...ui.input, flex: 1, minWidth: 0 }}
            placeholder="+1 555 123 4567"
            value={phone}
            onChange={(e) => onChangePhone(e.target.value)}
            readOnly={codeSent}
          />
          {codeSent && (
            <button type="button" style={ui.btnSecondary} onClick={onChangeNumber} disabled={loading}>
              Change
            </button>
          )}
        </div>

        {!codeSent ? (
          <>
            {/* Explicit transactional SMS opt-in, retained for Twilio compliance. */}
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 8,
              fontSize: 13, lineHeight: 1.5, color: '#cbd5f5' }}>
              <input
                id="sms-consent-cleaner"
                type="checkbox"
                checked={consent}
                onChange={onToggleConsent}
                style={{ marginTop: 3 }}
              />
              <label htmlFor="sms-consent-cleaner">
                I agree to receive transactional SMS from TurnQA at this number.
                Message &amp; data rates may apply. Reply <strong>STOP</strong> to opt
                out, <strong>HELP</strong> for help. Consent is not a condition of
                purchase.
              </label>
            </div>
          </>
        ) : (
          <>
            <label style={{ ...ui.label, display: 'block', marginTop: 18 }} htmlFor="code">
              6-digit verification code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              style={{ ...ui.input, letterSpacing: '0.14em' }}
              placeholder="123456"
              value={code}
              onChange={(e) => onChangeCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
            />
          </>
        )}

        <div style={{ marginTop: 18 }}>
          {!codeSent ? (
            <button type="submit" style={{ ...ui.btnPrimary, width: '100%' }}
              disabled={loading || !hasPhone || !consent}>
              {loading ? 'Sending code…' : 'Text me a verification code'}
            </button>
          ) : (
            <>
              <button type="submit" style={{ ...ui.btnPrimary, width: '100%' }}
                disabled={loading || code.length !== 6}>
                {loading ? 'Verifying…' : 'Verify & Continue'}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 10, marginTop: 14, flexWrap: 'wrap', fontSize: 13, color: '#94a3b8' }}>
                <span>Didn't get the code?</span>
                <ResendOtpButton phone={e164(phone)} role="cleaner" />
              </div>
            </>
          )}
        </div>

        {msg && (
          <div role="status" aria-live="polite" style={{ marginTop: 12, fontSize: 13,
            color: /failed|error|could not|please|invalid|expired/i.test(msg) ? '#fca5a5' : '#86efac' }}>
            {msg}
          </div>
        )}

        {/* Keep support and legal links available in both steps. */}
        <div style={{ marginTop: 18, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
          Need help?{' '}
          <a href="mailto:support@turnqa.com" style={{ color: '#cbd5e1', textDecoration: 'underline' }}>
            support@turnqa.com
          </a>
          {' '} · {' '}
          <a href="/contact" style={{ color: '#cbd5e1', textDecoration: 'underline' }}>Contact</a>
          {' '} · {' '}
          <a href="/legal/sms-terms" style={{ color: '#cbd5e1', textDecoration: 'underline' }}>SMS Terms</a>
          {' '} · {' '}
          <a href="/legal/privacy" style={{ color: '#cbd5e1', textDecoration: 'underline' }}>Privacy Policy</a>
        </div>
      </form>
    </Card>
  );
}
