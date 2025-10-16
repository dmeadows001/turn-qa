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
  const nextParam = typeof router.query?.next === 'string' ? router.query.next : '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // control redirect timing
  const signingInRef = useRef(false);
  const redirectedRef = useRef(false);

  const safeNext = (raw?: string) => {
    let n = raw && typeof raw === 'string' ? raw : '/dashboard';
    if (n.startsWith('/login')) n = '/dashboard';
    return n;
  };

  async function syncServerCookies(reason: string) {
    const { data, error } = await supabase.auth.getSession();
    const at = data?.session?.access_token;
    const rt = data?.session?.refresh_token;
    console.log('[login] syncServerCookies start:', reason, 'hasSession?', !!data?.session, 'err?', !!error);
    if (!at || !rt) return false;

    try {
      const res = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: at, refresh_token: rt }),
        credentials: 'include',
      });
      const ok = res.ok;
      console.log('[login] syncServerCookies done:', reason, 'ok?', ok);
      return ok;
    } catch (e) {
      console.warn('[login] syncServerCookies failed:', e);
      return false;
    }
  }

  const gotoNext = async (reason: string) => {
    const target = safeNext(nextParam);
    if (redirectedRef.current) return;
    redirectedRef.current = true;

    console.log(`[login] redirecting (${reason}) →`, target);
    try {
      await router.replace(target);
    } catch (e) {
      console.warn('[login] router.replace threw; considering hard nav', e);
    }

    // fallback only if we truly have a session and router didn’t move
    setTimeout(async () => {
      if (typeof window === 'undefined') return;
      const expected = new URL(target, window.location.origin).pathname;
      if (window.location.pathname === expected) return;
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        console.warn('[login] router did not navigate; forcing hard nav');
        window.location.href = target;
      } else {
        console.log('[login] no session yet — NOT forcing hard nav');
        redirectedRef.current = false;
      }
    }, 900);
  };

  // Session poller as a safety net (but don't redirect while signing)
  const startSessionPoll = () => {
    let tries = 0;
    const id = setInterval(async () => {
      tries += 1;
      const { data, error } = await supabase.auth.getSession();
      console.log('[login] poll getSession → error?', !!error, 'hasSession?', !!data?.session, 'try', tries);
      if (data?.session && !signingInRef.current) {
        clearInterval(id);
        // ensure cookies are synced before leaving
        await syncServerCookies('poll-session');
        gotoNext('poll-session-detected');
      }
      if (tries > 30) clearInterval(id); // ~9s
    }, 300);
  };

  // If already logged in on mount, sync cookies then go
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data, error }) => {
      console.log('[login] mount getSession → error?', !!error, 'hasSession?', !!data?.session);
      if (data?.session) {
        await syncServerCookies('mount-existing-session');
        gotoNext('existing-session');
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[login] onAuthStateChange:', event, 'hasSession?', !!session);
      if (session) {
        // user may have auto-signed from another tab or was already signed; sync then route
        if (!signingInRef.current) {
          await syncServerCookies(`state-change:${event}`);
          gotoNext(`state-change:${event}`);
        }
      }
    });

    return () => sub.subscription?.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    signingInRef.current = true;
    redirectedRef.current = false;

    console.log('[login] submitting…');
    startSessionPoll();

    const t0 = performance.now();
    try {
      console.log('[login] calling signInWithPassword…');
      const p = supabase.auth.signInWithPassword({ email, password });
      console.log('[login] signInWithPassword promise created:', p);

      const timeout = new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 4000));
      // @ts-ignore
      const result: any = await Promise.race([p, timeout]);
      const t1 = performance.now();

      if (result?.__timeout) {
        console.warn('[login] signInWithPassword timed out (4s) — will rely on poll/state-change.');
      } else {
        console.log('[login] signInWithPassword resolved in', Math.round(t1 - t0), 'ms;', {
          hasSession: !!result?.data?.session,
          hasError: !!result?.error,
        });
        if (result?.error) {
          console.error('[login] signInWithPassword error:', result.error);
          throw result.error;
        }
      }

      // Sync session to server cookies so SSR guards see it
      await syncServerCookies('post-signin');

      signingInRef.current = false;
      const { data: sessAfter } = await supabase.auth.getSession();
      if (sessAfter?.session) gotoNext('post-signin-session');
    } catch (e: any) {
      setMsg(e?.message || 'Sign-in failed');
      console.error('[login] caught error:', e);
      signingInRef.current = false;
    } finally {
      setLoading(false);
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
            'var(--bg), radial-gradient(1000px 600px at 80% -10%, rgba(124,92,255,.16), transparent 60%), radial-gradient(800px 500px at 0% 100%, rgba(0,229,255,.08), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%)'
        }}
      >
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
