// pages/signup.tsx
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import Header from '@/components/layout/Header';
import Image from 'next/image';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    const supabase = supabaseBrowser();

    // Build a safe base for redirects (works locally and on Vercel)
    const base =
      (typeof window !== 'undefined'
        ? window.location.origin
        : (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://www.turnqa.com')
      ).replace(/\/+$/, '');

    // Ask Supabase to send its email link to our auth callback
    const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: `${base}/auth/callback?next=/dashboard&email=${encodeURIComponent(email)}`
  }
});

    if (error) {
      setMsg(error.message);
      setLoading(false);
      return;
    }

    // If email confirmation is OFF, Supabase may return a session right away.
    // In that case, create the trial profile and send them to dashboard.
    if (data?.session?.user) {
      try {
        await fetch('/api/ensure-profile', { method: 'POST' });
      } catch {}
      window.location.href = '/dashboard';
      return;
    }

    // Otherwise, email confirmation is ON — tell them to check their inbox.
    setMsg(
      'Account created. Please check your email to confirm your address. After you click the link, we’ll finish sign-in and take you to your dashboard.'
    );
    setLoading(false);
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
          {/* Brand row with camera logo */}
          <div className="auth-brand" style={{ gap: 12 }}>
            <Image src="/logo-camera.svg" alt="TurnQA" width={28} height={28} priority />
            <div className="muted" style={{ fontWeight: 700, letterSpacing: 0.2 }}>
              TurnQA • Manager
            </div>
          </div>

          <h1 className="h1 accent" style={{ marginBottom: 18 }}>Start Free 30-Day Trial</h1>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
            <Input
              placeholder="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <Input
              placeholder="Create password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <PrimaryButton disabled={loading}>
              {loading ? 'Creating…' : 'Create Account'}
            </PrimaryButton>
            {msg && <p style={{ color: '#fda4af', fontSize: 14, marginTop: 6 }}>{msg}</p>}
          </form>

          {/* Compact legal line */}
          <p className="hint" style={{ marginTop: 10, fontSize: 12 }}>
            By continuing, you agree to our{' '}
            <Link href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</Link>{' '}
            and{' '}
            <Link href="/legal/privacy" style={{ textDecoration: 'underline' }}>Privacy Policy</Link>.
          </p>

          {/* Larger CTA */}
          <p className="hint" style={{ marginTop: 16, fontSize: 15, fontWeight: 600 }}>
            Already have an account?{' '}
            <Link href="/login" style={{ textDecoration: 'underline', color: 'var(--text)' }}>
              Sign in
            </Link>
          </p>
        </Card>
      </main>
    </>
  );
}
