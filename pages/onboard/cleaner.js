// pages/onboard/cleaner.js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

function normPhone(s = '') {
  const only = String(s || '').replace(/[^\d+]/g, '');
  if (!only) return '';
  if (only.startsWith('+')) return only;
  if (/^\d{10}$/.test(only)) return `+1${only}`;
  return `+${only}`;
}

export default function CleanerOnboard() {
  const router = useRouter();
  const inviteId =
    typeof router.query.id === 'string' ? router.query.id : '';

  const [step, setStep] = useState('load');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;

    let cancelled = false;

    (async () => {
      try {
        if (!inviteId) {
          if (!cancelled) setStep('phone');
          return;
        }

        const r = await fetch(
          `/api/invite/lookup?id=${encodeURIComponent(inviteId)}`
        );
        const j = await r.json();

        if (cancelled) return;

        if (r.ok && j?.phone) {
          setPhone(j.phone);
        }

        setStep('phone');
      } catch {
        if (!cancelled) setStep('phone');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router.isReady, inviteId]);

  async function sendCode() {
    const p = normPhone(phone);

    if (!/^\+\d{8,15}$/.test(p)) {
      setMsg('Enter a valid phone number');
      return;
    }

    setBusy(true);
    setMsg('');

    try {
      const r = await fetch('/api/sms/otp-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone: p }),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        throw new Error(j.error || 'Failed to send code');
      }

      try {
        localStorage.setItem('turnqa_phone', p);
      } catch {}

      setStep('code');
    } catch (e) {
      setMsg(e?.message || 'Failed to send code');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    const p = normPhone(phone);

    if (!p) {
      setMsg('Missing phone');
      return;
    }

    if (!code.trim()) {
      setMsg('Enter the code');
      return;
    }

    setBusy(true);
    setMsg('');

    try {
      const r = await fetch('/api/sms/otp-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          phone: p,
          code: code.trim(),
        }),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok || j.ok !== true) {
        throw new Error(j.error || 'Verification failed');
      }

      // The OTP verification endpoint now creates the
      // authenticated cleaner session cookie itself.
      // No separate login-by-phone request is necessary.

      try {
        localStorage.setItem('turnqa_phone', p);
      } catch {}

      setStep('done');
    } catch (e) {
      setMsg(e?.message || 'Verification failed');
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
              <h2 style={{ marginTop: 0, textAlign: 'center' }}>
                Verify your phone
              </h2>

              <p style={{ ...ui.muted, textAlign: 'center' }}>
                We’ll text you a one-time code to confirm it’s you.
              </p>

              <div
                style={{
                  marginTop: 12,
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr)',
                  gap: 8,
                }}
              >
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 123 4567"
                  type="tel"
                  autoComplete="tel"
                  style={{ ...ui.input, minWidth: 0 }}
                />

                <button
                  onClick={sendCode}
                  disabled={busy}
                  style={ui.btnPrimary}
                >
                  {busy ? 'Sending…' : 'Text me a code'}
                </button>
              </div>

              {msg && (
                <div style={{ color: '#fca5a5', marginTop: 10 }}>
                  {msg}
                </div>
              )}
            </>
          )}

          {step === 'code' && (
            <>
              <h2 style={{ marginTop: 0, textAlign: 'center' }}>
                Enter the code
              </h2>

              <div
                style={{
                  marginTop: 12,
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr)',
                  gap: 8,
                }}
              >
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  style={{ ...ui.input, minWidth: 0 }}
                />

                <button
                  onClick={verifyCode}
                  disabled={busy}
                  style={ui.btnPrimary}
                >
                  {busy ? 'Verifying…' : 'Verify & finish'}
                </button>
              </div>

              {msg && (
                <div style={{ color: '#fca5a5', marginTop: 10 }}>
                  {msg}
                </div>
              )}
            </>
          )}

          {step === 'done' && (
            <>
              <h2 style={{ marginTop: 0, textAlign: 'center' }}>
                You're all set
              </h2>

              <p style={{ ...ui.muted, textAlign: 'center' }}>
                Next: start a turn to take photos for review and get paid.
              </p>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  justifyContent: 'center',
                  marginTop: 12,
                }}
              >
                <a href="/capture" style={ui.btnPrimary}>
                  Start a turn now
                </a>

                <a href="/cleaner/turns" style={ui.btnSecondary}>
                  See my submissions
                </a>
              </div>
            </>
          )}
        </div>
      </section>
    </ChromeDark>
  );
}
