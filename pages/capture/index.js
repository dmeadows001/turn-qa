// pages/capture/index.js
import { useEffect, useState } from 'react';

// If you have ChromeDark, uncomment the next line and wrap <Page/> with it
// import ChromeDark from '../../components/ChromeDark';

function normalizePhone(s = '') {
  const d = (s || '').replace(/[^\d+]/g, '');
  return d.startsWith('+') ? d : `+${d}`;
}

export default function Page() {
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

  // ---- Simple dark styling so it matches your theme even without ChromeDark ----
  const shell = { maxWidth: 640, margin: '24px auto', padding: '0 16px', color: '#e5e7eb' };
  const input = { width:'100%', padding:12, borderRadius:12, border:'1px solid #334155', background:'#0b1220', color:'#e5e7eb' };
  const btn   = (b='#0ea5e9', t='#e0f2fe') => ({
    marginTop:12, padding:'12px 14px', borderRadius:12, border:`1px solid ${b}`,
    background:'#05293a', color:t, cursor:'pointer'
  });

  const content = (
    <div style={shell}>
      <h1 style={{ fontSize:32, fontWeight:800, marginBottom:10 }}>Start a Turn</h1>
      {msg && <div style={{ marginBottom:10, color:'#fca5a5' }}>{msg}</div>}

      {step === 'phone' && (
        <>
          <div style={{ color:'#94a3b8', marginBottom:8 }}>
            Enter your phone to get a verification code.
          </div>
          <input style={input} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+15551234567" />
          <button onClick={sendOtp} disabled={busy || !phone} style={btn()}>
            {busy ? 'Sending…' : 'Text me a code'}
          </button>
        </>
      )}

      {step === 'otp' && (
        <>
          <div style={{ color:'#94a3b8', marginBottom:8 }}>
            Enter the 6-digit code sent to <b>{normalizePhone(phone)}</b>.
          </div>
          <input style={{ ...input, letterSpacing:3 }} value={code} onChange={e=>setCode(e.target.value)} placeholder="123456" maxLength={6} />
          <button onClick={verifyOtp} disabled={busy || code.length < 4} style={btn('#16a34a', '#dcfce7')}>
            {busy ? 'Verifying…' : 'Verify & continue'}
          </button>
        </>
      )}

      {step === 'choose' && (
        <>
          <div style={{ color:'#94a3b8', marginBottom:8 }}>
            Welcome{cleaner?.name ? `, ${cleaner.name}` : ''}! Choose a property to start.
          </div>
          {properties.length === 0 ? (
            <div style={{ color:'#f97316' }}>No properties assigned. Ask your manager to add you.</div>
          ) : (
            <>
              <select style={input} value={propertyId} onChange={e=>setPropertyId(e.target.value)}>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <textarea style={{ ...input, height:100, marginTop:12 }} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Any special notes (optional)" />
              <button onClick={startTurn} disabled={busy || !propertyId} style={btn()}>
                {busy ? 'Starting…' : 'Start capture'}
              </button>
            </>
          )}
        </>
      )}

      {step === 'starting' && <div style={{ color:'#94a3b8' }}>Creating your turn…</div>}
    </div>
  );

  // If you have ChromeDark, wrap it; otherwise render the content directly.
  // return <ChromeDark title="Start a Turn">{content}</ChromeDark>;
  return (
    <div style={{ minHeight:'100vh', background:'#0a0f1a' }}>
      {content}
    </div>
  );
}
