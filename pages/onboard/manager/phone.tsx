// pages/onboard/manager/phone.tsx
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Header from '@/components/layout/Header';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

type Phase = 'collect' | 'verify';

export default function ManagerPhoneOnboard() {
  const [phase, setPhase] = useState<Phase>('collect');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getUser().then(({ data }) => {
      const u = data?.user ?? null;
      setUserId(u?.id ?? null);
    });
  }, []);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (!userId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/managers/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, phone }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to send code');
      setPhase('verify');
      setMsg('Code sent. It expires in 10 minutes.');
    } catch (err: any) {
      setMsg(err.message || 'Could not send code');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/managers/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, code, consent }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Verification failed');
      window.location.href = '/dashboard';
    } catch (err: any) {
      setMsg(err.message || 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main
        className="auth-wrap"
        style={{
          minHeight: 'calc(100vh - 56px)',
          background:
            'var(--bg), radial-gradient(1000px 600px at 80% -10%, rgba(124,92,255,.16), transparent 60%), radial-gradient(800px 500px at 0% 100%, rgba(0,229,255,.08), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%)',
        }}
      >
        <Card className="auth-card">
          <div style={{ display: 'grid', gap: 14 }}>
            <h1 className="h1 accent" style={{ marginBottom: 4 }}>
              Verify your phone
            </h1>
            <p className="hint" style={{ fontSize: 14 }}>
              When cleaners submit a turn, you’ll be notified instantly by text.
            </p>

            {phase === 'collect' && (
              <form onSubmit={sendCode} style={{ display: 'grid', gap: 12 }}>
                <Input
                  type="tel"
                  placeholder="+1XXXXXXXXXX"
                  value={phone}
                  onChange={(e: any) => setPhone(e.target.value)}
                  required
                />
                <label
                  className="hint"
                  style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}
                >
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  I agree to receive SMS alerts (STOP to opt out, HELP for help).
                </label>

                {/* changed: make this a submit button and disable until userId is ready */}
                {!userId && (
                  <p className="hint" style={{ fontSize: 12 }}>
                    Loading your session…
                  </p>
                )}
                <PrimaryButton type="submit" disabled={busy || !userId}>
                  {busy ? 'Sending…' : 'Send code'}
                </PrimaryButton>

                {msg && <p style={{ color: '#fda4af', fontSize: 14 }}>{msg}</p>}
              </form>
            )}

            {phase === 'verify' && (
              <form onSubmit={verifyCode} style={{ display: 'grid', gap: 12 }}>
                <Input
                  type="text"
                  placeholder="6-digit code"
                  value={code}
                  onChange={(e: any) =>
                    setCode(String(e.target.value).replace(/\D/g, '').slice(0, 6))
                  }
                  required
                />
                <div style={{ display: 'flex', gap: 12 }}>
                  {/* changed: submit button and disabled until userId is ready */}
                  <PrimaryButton type="submit" disabled={busy || !userId}>
                    {busy ? 'Verifying…' : 'Verify & continue'}
                  </PrimaryButton>
                  <button
                    type="button"
                    onClick={() => sendCode()}
                    disabled={busy || !userId}
                    style={{ textDecoration: 'underline' }}
                  >
                    Resend code
                  </button>
                </div>
                {msg && <p style={{ color: '#fda4af', fontSize: 14 }}>{msg}</p>}
              </form>
            )}
          </div>
        </Card>
      </main>
    </>
  );
}
