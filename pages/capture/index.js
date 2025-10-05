// pages/capture/index.js
import { useState } from 'react';
import ResendOtpButton from '@/components/ResendOtpButton';
import ChromeDark from '@/components/ChromeDark';

function normalizePhone(s = '') {
  const d = String(s || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d;
  // naive US default if 10 digits; tweak for intl if you like
  if (/^\d{10}$/.test(d)) return `+1${d}`;
  return `+${d}`;
}

export default function Capture() {
  const [phone, setPhone] = useState('');
  const [code, setCode]   = useState('');
  const [phase, setPhase] = useState('request'); // 'request' | 'code'
  const [msg, setMsg]     = useState(null);
  const [loading, setLoading] = useState(false);

  async function sendCode() {
    setMsg(null);
    setLoading(true);
    try {
      const e164 = normalizePhone(phone);
      if (!e164) throw new Error('Please enter a valid phone number.');
      const r = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'cleaner', phone: e164, consent: true }),
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
      const e164 = normalizePhone(phone);
      if (!e164) throw new Error('Please enter a valid phone number.');
      if (!code || String(code).length < 4) throw new Error('Please enter the code.');

      const r = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'cleaner', phone: e164, code }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Verify failed');

      // Server sets the cleaner session cookie on success. Reload into /capture
      // so your capture UI (which checks /api/me/cleaner) will render.
      setMsg('Verified! Loading capture…');
      window.location.href = '/capture';
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

          {/* Resend lives on the same page during the code phase */}
          <ResendOtpButton phone={phone} role="cleaner" />
        </>
      )}

      {msg && <div style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );

  return <ChromeDark title="Verify to start">{content}</ChromeDark>;
}
