// pages/login.tsx
import { useCallback, useMemo, useState } from 'react';
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

  const base = useMemo(() => {
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : (process.env.NEXT_PUBLIC_BASE_URL ||
           process.env.NEXT_PUBLIC_APP_BASE_URL ||
           'https://www.turnqa.com');
    return origin.replace(/\/+$/, '');
  }, []);

  const finishLogin = useCallback(async () => {
    // Create / update trial profile; ignore failures (they’ll still be logged)
    try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch (e) { console.warn('[login] ensure-profile failed', e); }
    // Go where the app wanted to go
    router.replace(nextUrl || '/dashboard');
  }, [nextUrl, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    console.log('[login] attempting password sign-in', { email });

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    console.log('[login] signInWithPassword result', { data, error });

    if (error) {
      setLoading(false);
      setMsg(error.message || 'Invalid login credentials');
      return;
    }

    // Successful password sign-in sets the session client-side immediately.
    await finishLogin();
  }

  async function sendMagicLink(e: React.MouseEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    console.log('[login] sending magic link', { email });

    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(nextUrl)}` }
    });

    console.log('[login] signInWithOtp result', { data, error });

    setLoading(false);
    if (error) {
      setMsg(error.message || 'Could not send link');
      return;
    }
    setMsg('We sent you a one-click sign-in link. Check your email.');
  }

  async function startPasswordReset(e: React.MouseEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    console.log('[login] starting password reset', { email });

    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${base}/auth/new-password?next=${encodeURIComponent(nextUrl)}`
    });

    console.log('[login] resetPasswordForEmail result', { data, error });

    setLoading(false);
    if (error) {
      setMsg(error.message || 'Could not start password reset');
      return;
    }
    setMsg('Password reset email sent. Check your inbox.');
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
            <Input
              placeholder="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <Input
              placeholder="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <PrimaryButton disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </PrimaryButton>

            {msg && (
              <p style={{ color: msg.match(/sent|link|Check|We sent/i) ? '#22c55e' : '#fda4af', fontSize: 14 }}>
                {msg}
              </p>
            )}
          </form>

          {/* Small helper actions */}
          <div className="hint" style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <button
              onClick={sendMagicLink}
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 14, padding: 0, textAlign: 'left' }}
            >
              Prefer no password? Email me a one-click sign-in link
            </button>

            <button
              onClick={startPasswordReset}
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 14, padding: 0, textAlign: 'left' }}
            >
              Forgot password? Reset it via email
            </button>
          </div>

          {/* Legal & CTA */}
          <p className="hint" style={{ marginTop: 12, fontSize: 12 }}>
            By continuing, you agree to our{' '}
            <Link href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</Link>{' '}
            and{' '}
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
