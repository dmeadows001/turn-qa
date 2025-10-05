// components/ResendOtpButton.jsx
import { useState, useCallback } from 'react';

export default function ResendOtpButton({ phone }) {
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [msg, setMsg] = useState('');

  // simple 30s cooldown timer
  const tick = useCallback(() => {
    setCooldown((c) => {
      if (c <= 1) return 0;
      setTimeout(tick, 1000);
      return c - 1;
    });
  }, []);

  async function resend() {
    setMsg('');
    if (!phone) {
      setMsg('Enter your phone number first.');
      return;
    }
    try {
      setSending(true);
      const r = await fetch('/api/sms/otp-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,     // e.g. "+15551234567" (we’ll normalize server-side too)
          // You can pass invite_id or cleaner_id instead if you have them
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Common helpful messages from our API:
        // - { error: 'opted_out', message: '...' }
        // - Twilio not configured
        setMsg(j.message || j.error || 'Could not send a code.');
        return;
      }
      setMsg('Code sent. Check your SMS.');
      setCooldown(30);
      setTimeout(tick, 1000);
    } catch (e) {
      setMsg(e?.message || 'Could not send a code.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={resend}
        disabled={sending || cooldown > 0}
        style={{
          padding: '8px 12px',
          borderRadius: 10,
          border: '1px solid #334155',
          background: '#0b1220',
          color: '#e5e7eb',
          cursor: sending || cooldown ? 'not-allowed' : 'pointer'
        }}
      >
        {sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
      </button>
      {msg && <div style={{ marginTop: 6, fontSize: 13, color: /sent|check/i.test(msg) ? '#22c55e' : '#fda4af' }}>{msg}</div>}
    </div>
  );
}
