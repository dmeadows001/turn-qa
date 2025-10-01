// pages/login.tsx
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Header from '@/components/layout/Header';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // where to send managers after login
      window.location.href = '/managers/turns';
    } catch (err: any) {
      setMsg(err?.message || 'Invalid login credentials');
    } finally {
      setLoading(false);
    }
  }

  // 👉 This is the new bit: send a reset-password email that will open /auth/new-password
  async function sendPasswordReset(e?: React.MouseEvent) {
    e?.preventDefault?.();
    try {
      setMsg('');
      if (!email) {
        setMsg('Enter your email above, then click “Reset password”.');
        return;
      }

      const base = (
        typeof window !== 'undefined'
          ? window.location.origin
          : (process.env.NEXT_PUBLIC_BASE_URL ||
             process.env.NEXT_PUBLIC_APP_BASE_URL ||
             'https://www.turnqa.com')
      ).replace(/\/+$/, '');

      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${base}/auth/new-password`,
      });
      if (error) throw error;

      setMsg('Reset email sent. Check your inbox for a link to set a new password.');
    } catch (err: any) {
      setMsg(err?.message || 'Could not send reset email.');
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
              id="email"
              placeholder="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <Input
              id="password"
              placeholder="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />

            <PrimaryButton disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </PrimaryButton>

            {/* 🔹 New: password reset link placed directly under the button */}
            <p className="hint" style={{ marginTop: 2, fontSize: 13 }}>
              Forgot your password?{' '}
              <a href="#" onClick={sendPasswordReset} style={{ textDecoration: 'underline' }}>
                Reset it via email
              </a>
            </p>

            {msg && (
              <p style={{ color: msg.toLowerCase().includes('sent') ? '#22c55e' : '#fda4af', fontSize: 14 }}>
                {msg}
              </p>
            )}
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
