// pages/capture/index.js
import { useEffect, useState } from 'react';
import ResendOtpButton from '@/components/ResendOtpButton';
import ChromeDark from '@/components/ChromeDark';

export default function Capture() {
  const [authed, setAuthed]   = useState(null); // null = checking, false = not logged in, true = cleaner logged in
  const [cleaner, setCleaner] = useState(null);

  const [phone, setPhone]     = useState('');
  const [code, setCode]       = useState('');
  const [phase, setPhase]     = useState('request'); // 'request' | 'code'
  const [msg, setMsg]         = useState(null);
  const [loading, setLoading] = useState(false);

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

      // verify.js already sets the cleaner cookie. Refresh session state:
      const m = await fetch('/api/me/cleaner');
      const mj = await m.json();
      if (m.ok && mj?.ok) {
        setCleaner(mj.cleaner);
        setAuthed(true);
        setMsg('Verified! You’re ready to capture.');
      } else {
        // fallback hard reload (shouldn’t be necessary, but harmless)
        window.location.href = '/capture';
      }
    } catch (e) {
      setMsg(e.message || 'Verify failed');
    } finally {
      setLoading(false);
    }
  }

  // ---- styles ----
  const wrap  = { maxWidth: 520, margin: '40px auto', display: 'grid', gap: 12 };
  const input = { width:'100%', padding:10, borderRadius:8, border:'1px solid #334155' };
  const btn   = { padding:'10px 14px', borderRadius:10, border:'1px solid #0ea5e9', background:'#e0f2fe', cursor:'pointer' };

  // 2) Content when authenticated (replace this with your real capture UI)
  const authedContent = (
    <div style={{ maxWidth: 720, margin: '40px auto', display: 'grid', gap: 14 }}>
      <h1>Ready to capture</h1>
      <div>Signed in as {cleaner?.phone || cleaner?.name || 'cleaner'}.</div>
      {/* TODO: swap this placeholder with your capture app/component */}
      <div style={{ padding: 16, border: '1px solid #334155', borderRadius: 10 }}>
        <p>🎉 You’re verified. Load your capture UI here.</p>
        {/* Example: <CaptureApp cleanerId={cleaner.id} /> */}
      </div>
    </div>
  );

  // 3) Verify form (when not authenticated)
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

  // While checking cookie, keep the shell stable
  const body = authed === null ? <div style={{ padding: 24 }}>Checking…</div>
             : authed ? authedContent
             : verifyContent;

  return <ChromeDark title={authed ? 'Capture' : 'Verify to start'}>{body}</ChromeDark>;
}
