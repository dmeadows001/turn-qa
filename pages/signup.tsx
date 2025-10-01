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

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // 🔑 Always return to your callback on the WWW host
        emailRedirectTo: 'https://www.turnqa.com/auth/callback?next=/dashboard',
      },
    });

    if (error) {
      setMsg(error.message);
      setLoading(false);
      return;
    }

    // If confirmations are OFF you may get a session immediately:
    if (data?.session?.user) {
      try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
      window.location.href = '/dashboard';
      return;
    }

    setMsg(
      'Account created. Check your email to confirm. After clicking the link, we’ll complete sign-in and take you to your dashboard.'
    );
    setLoading(false);
  }

  return (
    <>
      <Header />
      <main className="auth-wrap" style={{ minHeight: 'calc(100vh - 56px)' }}>
        <Card className="auth-card">
          <div className="auth-brand" style={{ gap: 12 }}>
            <Image src="/logo-camera.svg" alt="TurnQA" width={28} height={28} priority />
            <div className="muted" style={{ fontWeight: 700, letterSpacing: 0.2 }}>TurnQA • Manager</div>
          </div>

          <h1 className="h1 accent" style={{ marginBottom: 18 }}>Start Free 30-Day Trial</h1>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
            <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <Input placeholder="Create password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            <PrimaryButton disabled={loading}>{loading ? 'Creating…' : 'Create Account'}</PrimaryButton>
            {msg && <p style={{ color: '#fda4af', fontSize: 14, marginTop: 6 }}>{msg}</p>}
          </form>

          <p className="hint" style={{ marginTop: 10, fontSize: 12 }}>
            By continuing, you agree to our <Link href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</Link> and{' '}
            <Link href="/legal/privacy" style={{ textDecoration: 'underline' }}>Privacy Policy</Link>.
          </p>

          <p className="hint" style={{ marginTop: 16, fontSize: 15, fontWeight: 600 }}>
            Already have an account?{' '}
            <Link href="/login" style={{ textDecoration: 'underline', color: 'var(--text)' }}>Sign in</Link>
          </p>
        </Card>
      </main>
    </>
  );
}
