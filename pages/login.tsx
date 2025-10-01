import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import Header from '@/components/layout/Header';
import Image from 'next/image';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function Login() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  // where to go after login
  const nextPath = useMemo(() => {
    const n = (router.query?.next as string) || '/dashboard';
    return n.startsWith('/') ? n : '/dashboard';
  }, [router.query?.next]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // if already signed in, bounce to next
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) router.replace(nextPath);
    });
  }, [router, supabase, nextPath]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      // log raw so we can see 400/401 payloads in DevTools if anything is odd
      console.log('[login] result', { data, error });

      if (error) {
        setMsg(error.message || 'Invalid credentials');
        return;
      }
      // optional: create/refresh profile & trial window on successful login
      try {
        await fetch('/api/ensure-profile', { method: 'POST' });
      } catch (e) {
        console.warn('[login] ensure-profile failed (non-blocking)', e);
      }
      router.replace(nextPath);
    } catch (err: any) {
      console.error('[login] unexpected', err);
      setMsg(err?.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  // Optional helpers (visible + very explicit)
  async function sendMagicLink() {
    setMsg(null);
    setLoading(true);
    try {
      const base =
        (typeof window !== 'undefined'
          ? window.location.origin
          : (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://www.turnqa.com'))
        .replace(/\/+$/, '');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(nextPath)}` },
      });
      if (error) throw error;
      setMsg('We sent you a one-click sign-in link.');
    } catch (e: any) {
      setMsg(e?.message || 'Could not send link');
    } finally {
      setLoading(false);
    }
  }

  async function beginPasswordReset() {
    setMsg(null);
    setLoading(true);
    try {
      const base =
        (typeof window !== 'undefined'
          ? window.location.origin
          : (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://www.turnqa.com'))
        .replace(/\/+$/, '');
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${base}/auth/new-password`,
      });
      if (error) throw error;
      setMsg('Check your email for a password reset link.');
    } catch (e: any) {
      setMsg(e?.message || 'Could not start password reset');
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
            <div className="muted" style={{ fontWeight: 700, letterSpacing: 0.2 }}>
              TurnQA • Manager
            </div>
          </div>

          <h1 className="h1 accent" style={{ marginBottom: 18 }}>Sign in</h1>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
            <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <Input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            <PrimaryButton disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</PrimaryButton>
            {msg && (
              <p style={{ color: msg.toLowerCase().includes('sent you') || msg.toLowerCase().includes('check your email') ? '#22c55e' : '#fda4af', fontSize: 14 }}>
                {msg}
              </p>
            )}
          </form>

          {/* Helpful actions beneath the button */}
          <div className="hint" style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            <button onClick={sendMagicLink} style={{ textDecoration: 'underline', textAlign: 'left' }} disabled={loading || !email}>
              Prefer no password? Email me a one-click sign-in link
            </button>
            <button onClick={beginPasswordReset} style={{ textDecoration: 'underline', textAlign: 'left' }} disabled={loading || !email}>
              Forgot password? Reset it via email
            </button>
          </div>

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
