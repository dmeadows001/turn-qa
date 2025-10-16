// pages/login.tsx
import { useState, useEffect } from 'react';
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

  // If already logged in, bounce to dashboard immediately
  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      console.log('[login] mount getSession → error?', !!error, 'hasSession?', !!data?.session);
      if (data?.session) {
        console.log('[login] existing session; redirecting to', nextUrl);
        router.replace(nextUrl);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    console.log('[login] submitting…');

    const t0 = performance.now();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      const t1 = performance.now();

      if (error) {
        console.error('[login] signInWithPassword error:', error);
        throw error;
      }
      console.log('[login] signInWithPassword ok in', Math.round(t1 - t0), 'ms; immediate session?', !!data.session);

      // Double-check what Supabase thinks *after* sign-in settles.
      const { data: sessAfter, error: sessErr } = await supabase.auth.getSession();
      console.log('[login] post-signin getSession → error?', !!sessErr, 'hasSession?', !!sessAfter?.session);
      if (sessErr) console.warn('[login] post-signin getSession error:', sessErr);

      // Redirect (router) + fallback (location.href)
      console.log('[login] redirecting to', nextUrl);
      router.replace(nextUrl);

      setTimeout(() => {
        const expected = new URL(nextUrl, window.location.origin).pathname;
        if (window.location.pathname !== expected) {
          console.warn('[login] router.replace did not navigate; forcing location.href');
          window.location.href = nextUrl;
        }
      }, 800);
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
          'var(--bg), radial-gradient(1000px 600px at 80% -10%, rgba(124,92,255,.16), transparent 60%), radial-gradient(800px 500px at 0% 100%, rgba(0,229,255,.08), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%)'
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
