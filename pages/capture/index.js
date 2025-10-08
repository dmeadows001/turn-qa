// pages/capture/index.js
import { useEffect, useMemo, useState } from 'react';
import ChromeDark from '@/components/ChromeDark';
import ResendOtpButton from '@/components/ResendOtpButton';
import { ui } from '@/lib/theme';

function e164(s='') {
  const d = String(s||'').replace(/[^\d+]/g,'');
  if (!d) return '';
  if (d.startsWith('+')) return d;
  if (/^\d{10}$/.test(d)) return `+1${d}`;
  return `+${d}`;
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
  const urlTab = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('tab') || '';
  }, []);
  const [activeTab, setActiveTab] = useState(urlTab || 'fix'); // default to fix if any exist

  // ------------------------------------------------------------------
  // 1) Check cookie; if logged in as cleaner, preload properties + needs_fix
  // ------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/me/cleaner');
        if (r.status === 401) { setPhase('verify'); return; }
        const j = await r.json();
        if (!j?.cleaner?.phone) { setPhase('verify'); return; }

        // Load properties
        const p = await fetch('/api/cleaner/properties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: j.cleaner.phone })
        }).then(x => x.json());
        const props = p.properties || [];
        setProperties(props);
        if (props.length) setPropertyId(props[0].id);

        // Load turns needing attention
        const fx = await fetch('/api/cleaner/turns?status=needs_fix')
          .then(r => r.json()).catch(() => ({ rows: [] }));
        setFixTurns(Array.isArray(fx?.rows) ? fx.rows : []);

        // Tab choice
        if (urlTab) setActiveTab(urlTab);
        else if ((fx?.rows || []).length) setActiveTab('fix');
        else setActiveTab('start');

        setPhase('start');
      } catch {
        setPhase('verify');
      }
    })();
  }, [urlTab]);

  // ------------------------------------------------------------------
  // 2) Verify: send + verify code
  // ------------------------------------------------------------------
  async function sendCode() {
    setMsg(null); setLoading(true);
    try {
      const r = await fetch('/api/otp/send', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ role: 'cleaner', phone: e164(phone), consent: true })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not send code');
      setMsg('Code sent! Check your texts.');
    } catch (e) {
      setMsg(e.message || 'Send failed');
    } finally { setLoading(false); }
  }

  async function verifyCode() {
    setMsg(null); setLoading(true);
    try {
      const r = await fetch('/api/otp/verify', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ role:'cleaner', phone: e164(phone), code })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Verify failed');
      window.location.href = '/capture?tab=start';
    } catch (e) {
      setMsg(e.message || 'Verify failed');
    } finally { setLoading(false); }
  }

  // ------------------------------------------------------------------
  // 3) Start turn
  // ------------------------------------------------------------------
  async function startTurn() {
    if (!propertyId) return;
    setPropsLoading(true); setMsg(null);
    try {
      const r = await fetch('/api/cleaner/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'start failed');
      if (!j.turn_id) throw new Error('No turn id returned');
      window.location.href = `/turns/${j.turn_id}/capture`;
    } catch (e) {
      setMsg(e.message || 'Start failed');
    } finally { setPropsLoading(false); }
  }

  // ------------------------------------------------------------------
  // UI Helpers
  // ------------------------------------------------------------------
  const Card = ({ children, max=420 }) => (
    <div style={{ ...ui.card, maxWidth: max, margin: '0 auto' }}>{children}</div>
  );

  const Tabs = () => (
    <div style={ui.tabs}>
      <div style={ui.tab(activeTab==='fix')} onClick={() => setActiveTab('fix')}>Needs fix</div>
      <div style={ui.tab(activeTab==='start')} onClick={() => setActiveTab('start')}>Start</div>
    </div>
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (phase === 'checking') {
    return (
      <ChromeDark title="Capture">
        <section style={ui.sectionGrid}><Card>Loading…</Card></section>
      </ChromeDark>
    );
  }

  if (phase === 'verify') {
    return (
      <ChromeDark title="Capture">
        <section style={ui.sectionGrid}>
          <Card max={480}>
            <h2 style={{ marginTop: 0 }}>Verify your phone</h2>

            <label style={ui.label}>Phone</label>
            <input
              style={ui.input}
              placeholder="+1 555 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <div style={{ display:'flex', gap:10, marginTop:10 }}>
              <button style={ui.btnPrimary} onClick={sendCode} disabled={loading}>
                {loading ? 'Sending…' : 'Text me a code'}
              </button>
              {!!phone && <ResendOtpButton phone={e164(phone)} role="cleaner" />}
            </div>

            <div style={{ height: 10 }} />

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
            <div style={{ display:'flex', gap:10, marginTop:10 }}>
              <button style={ui.btnSecondary} onClick={verifyCode} disabled={loading}>
                {loading ? 'Verifying…' : 'Verify'}
              </button>
            </div>

            {msg && <div style={{ marginTop:10 }}>{msg}</div>}
          </Card>
        </section>
      </ChromeDark>
    );
  }

  // phase === 'start'
  return (
    <ChromeDark title="Capture">
      <section style={{ ...ui.sectionGrid, maxWidth: 420, margin:'0 auto' }}>
        <Tabs />

        {/* Needs fix panel */}
        {activeTab === 'fix' && (
          <Card>
            <h2 style={{ marginTop: 0 }}>Needs fix</h2>
            {!fixTurns.length ? (
              <div style={ui.subtle}>Nothing to fix right now.</div>
            ) : (
              <div style={{ display:'grid', gap:12 }}>
                {fixTurns.map(t => (
                  <div key={t.id} style={{ border:`1px solid ${ui.card.border || '#334155'}`, borderRadius:12, padding:12, background:'#0b1220' }}>
                    <div style={{ fontWeight:700 }}>{t.property_name || 'Property'}</div>
                    <div style={{ fontSize:13, color:'#94a3b8', marginTop:4 }}>
                      Turn #{t.id.slice(0,8)} &middot; status: {t.status}
                    </div>
                    <div style={{ marginTop:10 }}>
                      <a href={`/turns/${t.id}/capture`} style={ui.btnPrimary}>Resume</a>
                    </div>
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
            <div style={{ position:'relative' }}>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                style={{ ...ui.input, appearance:'none', paddingRight:34 }}
              >
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {/* Chevron */}
              <div style={{
                position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                width:0, height:0, borderLeft:'6px solid transparent',
                borderRight:'6px solid transparent', borderTop:'8px solid #94a3b8', pointerEvents:'none'
              }} />
            </div>

            <div style={{ marginTop:12 }}>
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
