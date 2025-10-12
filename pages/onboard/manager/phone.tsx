// pages/onboard/manager/phone.tsx
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/layout/Header';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';

type Props = {
  userId: string | null; // may be null on first SSR
};

export default function ManagerPhoneOnboard({ userId: ssrUserId }: Props) {
  const router = useRouter();
  // Prefer uid from query (set by signup), then SSR, then client auth
  const uidFromQuery = useMemo(() => {
    const u = router.query.uid;
    return typeof u === 'string' && u.length > 0 ? u : null;
  }, [router.query.uid]);

  const [userId, setUserId] = useState<string | null>(uidFromQuery ?? ssrUserId ?? null);
  const [phase, setPhase] = useState<'collect' | 'verify'>('collect');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // If neither query nor SSR provided a uid, hydrate from client auth
  useEffect(() => {
    if (userId) return;
    const supabase = supabaseBrowser();
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id ?? null);
    });
  }, [userId]);

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

/** Server-side: tolerate missing SSR session; client or query will supply uid */
export async function getServerSideProps(
  ctx: GetServerSidePropsContext
): Promise<GetServerSidePropsResult<Props>> {
  const supabase = createServerSupabaseClient(ctx);
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // If already verified + consented, skip this page
    const { data: mgr } = await supabase
      .from('managers')
      .select('phone, sms_consent, phone_verified_at')
      .eq('user_id', user.id)
      .single();

    const alreadyVerified = !!(mgr?.phone && mgr?.sms_consent && mgr?.phone_verified_at);
    if (alreadyVerified) {
      return { redirect: { destination: '/dashboard', permanent: false } };
    }
    return { props: { userId: user.id } };
  }

  // No SSR session yet → proceed; uid will arrive via query or client
  return { props: { userId: null } };
}
