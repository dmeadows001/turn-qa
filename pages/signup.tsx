// pages/signup.tsx
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

import { supabaseBrowser } from '@/lib/supabaseBrowser';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import Header from '@/components/layout/Header';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    const supabase = supabaseBrowser();

    try {
      // 1) create user
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email, password });
      if (signUpErr) throw signUpErr;

      // 2) If email confirmation is OFF, this will succeed immediately.
      //    If it's ON, this may fail until the user confirms—either way we still redirect;
      //    the verify page can hydrate client-side if SSR doesn't see the session yet.
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) {
        // Non-fatal for our flow; user may still have a session soon or after confirming email.
        console.warn('signInWithPassword error:', signInErr.message);
      }

      // 2b) Nudge the session to be present before the next SSR hop
      await supabase.auth.getSession();
      await new Promise((r) => setTimeout(r, 150));

      // 3) seed / refresh 30-day trial profile (your existing endpoint)
      try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}

      // 4) Route to phone verification step
      window.location.href = '/onboard/manager/phone';
    } catch (e: any) {
      setMsg(e?.message || 'Sign-up failed');
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

          <h1 className="h1 accent" style={{ marginBottom: 18 }}>Start Free 30-Day Trial</h1>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
            <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <Input placeholder="Create password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            <PrimaryButton disabled={loading}>{loading ? 'Creating…' : 'Create Account'}</PrimaryButton>
            {msg && <p style={{ color: '#fda4af', fontSize: 14 }}>{msg}</p>}
          </form>

          <p className="hint" style={{ marginTop: 10, fontSize: 12 }}>
            By continuing, you agree to our{' '}
            <Link href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</Link>{' '}
            and{' '}
            <Link href="/legal/privacy" style={{ textDecoration: 'underline' }}>Privacy Policy</Link>.
          </p>

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
