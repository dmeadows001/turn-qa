// pages/onboard/cleaner.js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

function normPhone(s='') {
  const only = (s || '').replace(/[^\d+]/g,'');
  if (!only) return '';
  if (only.startsWith('+')) return only;
  if (/^\d{10}$/.test(only)) return `+1${only}`;
  return `+${only}`;
}

export default function CleanerOnboard() {
  const router = useRouter();
  const inviteId = typeof router.query.id === 'string' ? router.query.id : '';
  const [step, setStep] = useState('load'); // load | phone | code | done
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // If we arrived from an invite link, we may already know the phone
  useEffect(() => {
    (async () => {
      try {
        if (!inviteId) { setStep('phone'); return; }
        const r = await fetch(`/api/invite/lookup?id=${inviteId}`);
        const j = await r.json();
        if (r.ok && j?.phone) {
          setPhone(j.phone);
          setStep('phone');
        } else {
          setStep('phone');
        }
      } catch {
        setStep('phone');
      }
    })();
  }, [inviteId]);

  async function sendCode() {
    const p = normPhone(phone);
    if (!p) { setMsg('Enter a valid phone number'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/sms/otp-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to send code');
      // Save for future pages (and done page)
      try { localStorage.setItem('turnqa_phone', p); } catch {}
      setStep('code');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    const p = normPhone(phone);
    if (!p) { setMsg('Missing phone'); return; }
    if (!code.trim()) { setMsg('Enter the code'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/sms/otp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p, code: code.trim() })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Verify failed');

      // Silently create session cookie (so future capture skips OTP)
      try {
        const r2 = await fetch('/api/session/login-by-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: p })
        });
        // even if this fails, proceed to done
        await r2.json().catch(()=>{});
      } catch {}

      setStep('done');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ChromeDark title="Cleaner onboarding">
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          {step === 'load' && <div>Loading…</div>}

          {step === 'phone' && (
            <>
              <h2 style={{ marginTop:0, textAlign:'center' }}>Verify your phone</h2>
              <p style={{ ...ui.muted, textAlign:'center' }}>
                We’ll text you a one-time code to confirm it’s you.
              </p>
              <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
                <input
                  value={phone}
                  onChange={e=>setPhone(e.target.value)}
                  placeholder="+1 555 123 4567"
                  style={ui.input}
                />
                <button onClick={sendCode} disabled={busy} style={ui.btnPrimary}>
                  {busy ? 'Sending…' : 'Text me a code'}
                </button>
              </div>
              {msg && <div style={{ color:'#fca5a5', marginTop:10 }}>{msg}</div>}
            </>
          )}

          {step === 'code' && (
            <>
              <h2 style={{ marginTop:0, textAlign:'center' }}>Enter the code</h2>
              <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
                <input
                  value={code}
                  onChange={e=>setCode(e.target.value)}
                  placeholder="123456"
                  style={ui.input}
                />
                <button onClick={verifyCode} disabled={busy} style={ui.btnPrimary}>
                  {busy ? 'Verifying…' : 'Verify & finish'}
                </button>
              </div>
              {msg && <div style={{ color:'#fca5a5', marginTop:10 }}>{msg}</div>}
            </>
          )}

          {step === 'done' && (
            <>
              <h2 style={{ marginTop:0, textAlign:'center' }}>You're all set</h2>
              <p style={{ ...ui.muted, textAlign:'center' }}>
                Next: start a turn to take photos for review and get paid.
              </p>
              <div style={{ display:'flex', gap:12, justifyContent:'center', marginTop:12 }}>
                <a href="/capture" style={ui.btnPrimary}>Start a turn now</a>
                <a href="/cleaner/turns" style={ui.btnSecondary}>See my submissions</a>
              </div>
            </>
          )}
        </div>
      </section>
    </ChromeDark>
  );
}
