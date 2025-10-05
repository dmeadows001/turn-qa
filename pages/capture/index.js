// pages/capture/index.js
import { useEffect, useMemo, useState } from 'react';
import ResendOtpButton from '@/components/ResendOtpButton';
import ChromeDark from '@/components/ChromeDark';

export default function Capture() {
  const [authed, setAuthed]   = useState(null); // null=checking, false=not, true=cleaner
  const [cleaner, setCleaner] = useState(null);

  // verify form state
  const [phone, setPhone]     = useState('');
  const [code, setCode]       = useState('');
  const [phase, setPhase]     = useState('request'); // 'request' | 'code'
  const [msg, setMsg]         = useState(null);
  const [loading, setLoading] = useState(false);

  // authed (capture) state
  const [propsLoading, setPropsLoading] = useState(false);
  const [properties, setProperties]     = useState([]);
  const [propertyId, setPropertyId]     = useState('');
  const [startMsg, setStartMsg]         = useState(null);
  const [starting, setStarting]         = useState(false);

  // 1) On mount, see if we already have a cleaner session cookie
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/me/cleaner');
        const j = await r.json();
        if (r.ok && j?.ok) {
          setCleaner(j.cleaner);
          setAuthed(true);
        } else {
          setAuthed(false);
        }
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  // 2) If authed, load the properties this cleaner can work on
  useEffect(() => {
    if (!authed || !cleaner?.id) return;
    (async () => {
      setPropsLoading(true);
      setStartMsg(null);
      try {
        // you already have this endpoint:
        // GET /api/list-my-properties?cleaner_id=<uuid> -> { rows: [{id,name}, ...] }
        const r = await fetch(`/api/list-my-properties?cleaner_id=${encodeURIComponent(cleaner.id)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Could not load properties');
        const rows = Array.isArray(j.rows) ? j.rows : [];
        setProperties(rows);
        if (rows.length === 1) {
          setPropertyId(rows[0].id);
        }
      } catch (e) {
        setStartMsg(e.message || 'Could not load properties');
      } finally {
        setPropsLoading(false);
      }
    })();
  }, [authed, cleaner?.id]);

  async function sendCode() {
    setMsg(null);
    setLoading(true);
    try {
      const r = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'cleaner', phone, consent: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not send code');
      setPhase('code');
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
        body: JSON.stringify({ role: 'cleaner', phone, code }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Verify failed');

      // verify.js sets the cookie – refresh session state:
      const m = await fetch('/api/me/cleaner');
      const mj = await m.json();
      if (m.ok && mj?.ok) {
        setCleaner(mj.cleaner);
        setAuthed(true);
        setMsg('Verified! You’re ready to capture.');
      } else {
        window.location.href = '/capture'; // fallback refresh
      }
    } catch (e) {
      setMsg(e.message || 'Verify failed');
    } finally {
      setLoading(false);
    }
  }

  async function startTurn() {
    setStartMsg(null);
    if (!propertyId) {
      setStartMsg('Please choose a property.');
      return;
    }
    setStarting(true);
    try {
      // You already have /api/cleaner/start-turn which checks assignment:
      const r = await fetch('/api/cleaner/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cleaner_id: cleaner.id,
          property_id: propertyId,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start turn');

      // Jump into your existing capture route:
      window.location.href = `/turns/${j.turn_id}/capture`;
    } catch (e) {
      setStartMsg(e.message || 'Start failed');
    } finally {
      setStarting(false);
    }
  }

  // ---- styles ----
  const wrap  = { maxWidth: 520, margin: '40px auto', display: 'grid', gap: 12 };
  const input = { width:'100%', padding:10, borderRadius:8, border:'1px solid #334155' };
  const btn   = { padding:'10px 14px', borderRadius:10, border:'1px solid #0ea5e9', background:'#e0f2fe', cursor:'pointer' };

  // Authed capture UI: choose property → start turn
  const authedContent = (
    <div style={{ maxWidth: 720, margin: '40px auto', display: 'grid', gap: 16 }}>
      <h1>Ready to capture</h1>
      <div>Signed in as {cleaner?.phone || cleaner?.name || 'cleaner'}.</div>

      <div style={{ padding: 16, border: '1px solid #334155', borderRadius: 10, display:'grid', gap:12 }}>
        <label style={{ fontWeight: 600 }}>Choose a property</label>
        <select
          disabled={propsLoading}
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          style={{ ...input, padding: 8 }}
        >
          <option value="">-- Select --</option>
          {properties.map(p => (
            <option key={p.id} value={p.id}>{p.name || p.id}</option>
          ))}
        </select>

        <div>
          <button onClick={startTurn} disabled={starting || !propertyId} style={btn}>
            {starting ? 'Starting…' : 'Start turn'}
          </button>
        </div>

        {startMsg && <div>{startMsg}</div>}
      </div>
    </div>
  );

  // Verify form (when not authenticated)
  const verifyContent = (
    <div style={wrap}>
      <h1>{phase === 'request' ? 'Verify your phone' : 'Enter the 6-digit code'}</h1>

      <input
        placeholder="+1 555 123 4567"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        style={input}
      />

      {phase === 'request' ? (
        <button onClick={sendCode} disabled={loading} style={btn}>
          {loading ? 'Sending…' : 'Text me a code'}
        </button>
      ) : (
        <>
          <input
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            style={input}
            inputMode="numeric"
            pattern="\d*"
          />
          <button onClick={verifyCode} disabled={loading} style={btn}>
            {loading ? 'Verifying…' : 'Verify'}
          </button>
          <ResendOtpButton phone={phone} role="cleaner" />
        </>
      )}

      {msg && <div style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );

  const body =
    authed === null ? <div style={{ padding: 24 }}>Checking…</div> :
    authed ? authedContent : verifyContent;

  return <ChromeDark title={authed ? 'Capture' : 'Verify to start'}>{body}</ChromeDark>;
}
