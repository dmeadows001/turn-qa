// pages/login.tsx
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Image from 'next/image';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import Header from '@/components/layout/Header';

export default function Login() {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const nextUrl = typeof router.query?.next === 'string' ? router.query.next : '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const redirectedRef = useRef(false);

  // Helper: redirect once (debounced)
  const gotoNext = (reason: string) => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    console.log(`[login] redirecting to ${nextUrl} (${reason})`);
    try {
      // try router first
      // @ts-ignore
      router.replace(nextUrl);
      // hard fallback if router stalls
      setTimeout(() => {
        const expected = new URL(nextUrl, window.location.origin).pathname;
        if (window.location.pathname !== expected) {
          console.warn('[login] router.replace did not navigate; forcing location.href');
          window.location.href = nextUrl;
        }
      }, 800);
    } catch (e) {
      console.warn('[login] router.replace threw; forcing location.href', e);
      window.location.href = nextUrl;
    }
  };

  // If already logged in, bounce to dashboard immediately
  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      console.log('[login] mount getSession → error?', !!error, 'hasSession?', !!data?.session);
      if (data?.session) gotoNext('existing-session');
    });

    // Log auth state changes so we can see if Supabase fires them
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[login] onAuthStateChange:', event, 'hasSession?', !!session);
      if (session) gotoNext(`state-change:${event}`);
    });
    return () => sub.subscription?.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poller: if session appears after sign-in but promise hangs, we still navigate
  const startSessionPoll = () => {
    let tries = 0;
    const id = setInterval(async () => {
      tries += 1;
      const { data, error } = await supabase.auth.getSession();
      console.log('[login] poll getSession → error?', !!error, 'hasSession?', !!data?.session, 'try', tries);
      if (data?.session) {
        clearInterval(id);
        gotoNext('poll-session-detected');
      }
      if (tries > 30) clearInterval(id); // stop after ~9s
    }, 300);
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    console.log('[login] submitting…');
    startSessionPoll();

    const t0 = performance.now();
    try {
      console.log('[login] calling signInWithPassword…');
      const p = supabase.auth.signInWithPassword({ email, password });
      console.log('[login] signInWithPassword promise created:', p);

      // Race with a visibility timeout so we can see if it stalls
      const timeout = new Promise((resolve) => {
        setTimeout(() => resolve({ __timeout: true }), 4000);
      });

      // @ts-ignore
      const result: any = await Promise.race([p, timeout]);
      const t1 = performance.now();

      if (result?.__timeout) {
        console.warn('[login] signInWithPassword timed out (4s) — will rely on session poll + state change.');
      } else {
        console.log('[login] signInWithPassword resolved in', Math.round(t1 - t0), 'ms; result:', {
          hasSession: !!result?.data?.session,
          hasError: !!result?.error,
        });
        if (result?.error) {
          console.error('[login] signInWithPassword error:', result.error);
          throw result.error;
        }
      }

      // Double-check after sign-in
      const { data: sessAfter, error: sessErr } = await supabase.auth.getSession();
      console.log('[login] post-signin getSession → error?', !!sessErr, 'hasSession?', !!sessAfter?.session);

      if (sessAfter?.session) gotoNext('post-signin-session');
      // else: session poll / onAuthStateChange will handle it
    } catch (e: any) {
      setMsg(e?.message || 'Sign-in failed');
      console.error('[login] caught error:', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="auth-wrap" style={{
        minHeight: 'calc(100vh - 56px)',
        background:
          'var(--bg), radial-gradient(1000px 600px at 80% -10%, rgba(124,92,255,.16), transparent 60%), radial-gradient(800px 500px at 0% 100%, rgba(0% 100%), rgba(0,229,255,.08), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%)'
      }}>
        <Card className="auth-card">
          <div className="auth-brand" style={{ gap: 12 }}>
            <Image src="/logo-camera.svg" alt="TurnQA" width={28} height={28} priority />
            <div className="muted" style={{ fontWeight: 700, letterSpacing: 0.2 }}>TurnQA • Manager</div>
          </div>

          <h1 className="h1 accent" style={{ marginBottom: 18 }}>Sign in</h1>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
            <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <Input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            <PrimaryButton disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</PrimaryButton>
            {msg && <p style={{ color: '#fda4af', fontSize: 14 }}>{msg}</p>}
          </form>

          <p className="hint" style={{ marginTop: 10, fontSize: 12 }}>
            By continuing, you agree to our{' '}
            <Link href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</Link>
            {' '}and{' '}
            <Link href="/legal/privacy" style={{ textDecoration: 'underline' }}>Privacy Policy</Link>.
          </p>

          <p className="hint" style={{ marginTop: 16, fontSize: 15, fontWeight: 600 }}>
            New here?{' '}
            <Link href="/signup" style={{ textDecoration: 'underline', color: 'var(--text)' }}>
              Start your free trial
            </Link>
          </p>
        </Card>
      </main>
    </>
  );
}
