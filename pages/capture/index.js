// pages/capture/index.js
import { useState } from 'react';
import ResendOtpButton from '@/components/ResendOtpButton';
import ChromeDark from '@/components/ChromeDark'; // remove if you don't use it

export default function Capture() {
  const [phone, setPhone]   = useState('');
  const [code, setCode]     = useState('');
  const [phase, setPhase]   = useState('request'); // 'request' | 'code'
  const [msg, setMsg]       = useState(null);
  const [loading, setLoading] = useState(false);

  async function sendCode() {
    setMsg(null);
    setLoading(true);
    try {
      const r = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'cleaner',
          phone,
          consent: true, // we ask for consent before sending
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not send code');
      setPhase('code'); // move to code entry step
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
        body: JSON.stringify({
          role: 'cleaner',
          phone,
          code,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Verify failed');

      // Verified — proceed to the capture flow. If your capture UI
      // is also at /capture, just reload to pick up “verified” state.
      setMsg('Verified! Loading capture…');
      window.location.href = '/capture';
    } catch (e) {
      setMsg(e.message || 'Verify failed');
    } finally {
      setLoading(false);
    }
  }

  // ---- styles (kept simple / inline like your project) ----
  const wrap  = { maxWidth: 520, margin: '40px auto', display: 'grid', gap: 12 };
  const input = { width:'100%', padding:10, borderRadius:8, border:'1px solid #334155' };
  const btn   = { padding:'10px 14px', borderRadius:10, border:'1px solid #0ea5e9', background:'#e0f2fe', cursor:'pointer' };

  const content = (
    <div style={wrap}>
      <h1>{phase === 'request' ? 'Verify your phone' : 'Enter the 6-digit code'}</h1>

      {/* Keep phone visible in both phases so the user can correct it */}
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

          {/* Resend button shown on the same page during the code phase */}
          <ResendOtpButton phone={phone} role="cleaner" />
        </>
      )}

      {msg && <div style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );

  // If you use ChromeDark site-wide:
  return <ChromeDark title="Verify to start">{content}</ChromeDark>;
  // If you don’t use ChromeDark, just:
  // return content;
}
