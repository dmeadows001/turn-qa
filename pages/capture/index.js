// pages/capture/index.js
import { useEffect, useState } from 'react';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

function normPhone(s='') {
  const only = (s || '').replace(/[^\d+]/g,'');
  if (!only) return '';
  if (only.startsWith('+')) return only;
  if (/^\d{10}$/.test(only)) return `+1${only}`;
  return `+${only}`;
}

export default function CaptureHome() {
  const [session, setSession] = useState(null); // { cleaner: { id, name, phone } } | null
  const [loading, setLoading] = useState(true);
  const [propsLoading, setPropsLoading] = useState(false);
  const [propsErr, setPropsErr] = useState('');
  const [list, setList] = useState([]); // properties { id, name }
  const [selected, setSelected] = useState('');
  const [note, setNote] = useState('');
  const [starting, setStarting] = useState(false);

  // OTP flow state (fallback)
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpStep, setOtpStep] = useState('phone'); // phone | code
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/me/cleaner');
        const j = await r.json();
        if (r.ok && j?.cleaner) {
          setSession(j);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!session?.cleaner?.id) return;
      setPropsLoading(true); setPropsErr('');
      try {
        const u = new URL('/api/list-my-properties', window.location.origin);
        u.searchParams.set('cleaner_id', session.cleaner.id);
        const r = await fetch(u.toString());
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'load failed');
        setList(j.rows || []);
        if ((j.rows || []).length) setSelected(j.rows[0].id);
      } catch (e) {
        setPropsErr(e.message || 'Failed to load properties');
      } finally {
        setPropsLoading(false);
      }
    })();
  }, [session?.cleaner?.id]);

  async function startTurn() {
    if (!selected) return;
    setStarting(true);
    try {
      const r = await fetch('/api/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: session?.cleaner?.phone || '',
          property_id: selected,
          notes: note || ''
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'start failed');
      window.location.href = `/turns/${j.turn_id}/capture`;
    } catch (e) {
      alert(e.message || 'Could not start a turn');
    } finally {
      setStarting(false);
    }
  }

  // ---- OTP fallback (if no session) ----
  async function otpSend() {
    const p = normPhone(phone);
    if (!p) { setOtpMsg('Enter a valid phone'); return; }
    setOtpBusy(true); setOtpMsg('');
    try {
      const r = await fetch('/api/sms/otp-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to send code');
      try { localStorage.setItem('turnqa_phone', p); } catch {}
      setOtpStep('code');
    } catch (e) {
      setOtpMsg(e.message);
    } finally {
      setOtpBusy(false);
    }
  }

  async function otpVerify() {
    const p = normPhone(phone);
    if (!p || !code.trim()) { setOtpMsg('Enter the code'); return; }
    setOtpBusy(true); setOtpMsg('');
    try {
      const r = await fetch('/api/sms/otp-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p, code: code.trim() })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Verify failed');

      // set session cookie
      await fetch('/api/session/login-by-phone', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ phone: p })
      });

      // get session -> then load properties
      const me = await fetch('/api/me/cleaner').then(r=>r.json()).catch(()=>null);
      if (me?.cleaner) setSession(me);
    } catch (e) {
      setOtpMsg(e.message);
    } finally {
      setOtpBusy(false);
    }
  }

  if (loading) {
    return (
      <ChromeDark title="Start a turn">
        <section style={ui.sectionGrid}><div style={ui.card}>Loading…</div></section>
      </ChromeDark>
    );
  }

  // --- Authenticated (session) path ---
  if (session?.cleaner) {
    return (
      <ChromeDark title="Start a turn">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>
            <h2 style={{ marginTop:0, textAlign:'center' }}>Start a new turn</h2>
            <p style={{ ...ui.muted, textAlign:'center' }}>
              Welcome back <b>{session.cleaner.phone}</b>. Choose a property to begin.
            </p>

            {propsErr && <div style={{ color:'#fca5a5', marginBottom:8 }}>{propsErr}</div>}

            <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:10, marginTop:12 }}>
              <div>
                <div style={ui.label}>Property</div>
                <select value={selected} onChange={e=>setSelected(e.target.value)} style={{ ...ui.input, background:'#0b1220' }}>
                  {list.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <div style={ui.label}>Optional note</div>
                <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Anything your manager should know…" style={ui.input}/>
              </div>
              <div>
                <button onClick={startTurn} disabled={!selected || starting || propsLoading} style={ui.btnPrimary}>
                  {starting ? 'Starting…' : 'Start capture'}
                </button>
              </div>
            </div>
          </div>
        </section>
      </ChromeDark>
    );
  }

  // --- Fallback: OTP login ---
  return (
    <ChromeDark title="Verify to start">
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          {otpStep === 'phone' && (
            <>
              <h2 style={{ marginTop:0, textAlign:'center' }}>Verify your phone</h2>
              <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
                <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+1 555 123 4567" style={ui.input}/>
                <button onClick={otpSend} disabled={otpBusy} style={ui.btnPrimary}>
                  {otpBusy ? 'Sending…' : 'Text me a code'}
                </button>
              </div>
              {otpMsg && <div style={{ color:'#fca5a5', marginTop:10 }}>{otpMsg}</div>}
            </>
          )}
          {otpStep === 'code' && (
            <>
              <h2 style={{ marginTop:0, textAlign:'center' }}>Enter the code</h2>
              <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
                <input value={code} onChange={e=>setCode(e.target.value)} placeholder="123456" style={ui.input}/>
                <button onClick={otpVerify} disabled={otpBusy} style={ui.btnPrimary}>
                  {otpBusy ? 'Verifying…' : 'Verify & continue'}
                </button>
              </div>
              {otpMsg && <div style={{ color:'#fca5a5', marginTop:10 }}>{otpMsg}</div>}
            </>
          )}
        </div>
      </section>
    </ChromeDark>
  );
}
