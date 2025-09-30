// pages/login.tsx
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import Header from '@/components/layout/Header';
import Image from 'next/image';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [magicSending, setMagicSending] = useState(false);

  function appBase() {
    return (
      typeof window !== 'undefined'
        ? window.location.origin
        : (process.env.NEXT_PUBLIC_BASE_URL ||
           process.env.NEXT_PUBLIC_APP_BASE_URL ||
           'https://www.turnqa.com')
    ).replace(/\/+$/, '');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // ensure profile + trial (safe if it already exists)
      try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
      window.location.href = '/dashboard';
    } catch (err: any) {
      setMsg(err?.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function sendMagicLink(e: React.MouseEvent) {
    e.preventDefault();
    setMsg(null);

    if (!email) {
      setMsg('Enter your email first to receive a magic link.');
      return;
    }

    setMagicSending(true);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${appBase()}/auth/callback?next=/dashboard`
        }
      });
      if (error) throw error;
      setMsg('Check your email—click the link to finish sign-in.');
    } catch (err: any) {
      setMsg(err?.message || 'Could not send magic link.');
    } finally {
      setMagicSending(false);
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

            {/* Magic link button (inline, under password sign-in) */}
            <button
              onClick={sendMagicLink}
              className="btn"
              style={{ marginTop: 8 }}
              disabled={magicSending}
              type="button"
            >
              {magicSending ? 'Sending link…' : 'Email me a one-click sign-in link'}
            </button>

            {msg && <p style={{ color: msg.includes('Check your email') ? '#22c55e' : '#fda4af', fontSize: 14 }}>{msg}</p>}
          </form>

          {/* Compact legal line */}
          <p className="hint" style={{ marginTop: 10, fontSize: 12 }}>
            By continuing, you agree to our{' '}
            <Link href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</Link>
            {' '}and{' '}
            <Link href="/legal/privacy" style={{ textDecoration: 'underline' }}>Privacy Policy</Link>.
          </p>

          {/* Larger CTA */}
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
