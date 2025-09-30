import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Image from 'next/image';
import Header from '@/components/layout/Header';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function Login() {
  const router = useRouter();
  const nextPath = useMemo(() => {
    const qp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    return qp.get('next') || '/dashboard';
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const supabase = supabaseBrowser();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // Surface the exact reason
        console.error('[login] signIn error:', error);
        // Common friendly messages
        if (/email not confirmed/i.test(error.message)) {
          setMsg('Your email is not confirmed. Please click the magic link we sent you, or use "Email me a one-click sign-in link" below.');
        } else if (/invalid login credentials/i.test(error.message)) {
          setMsg('Invalid email or password. Please try again.');
        } else {
          setMsg(error.message || 'Sign-in failed.');
        }
        return;
      }

      // Success: double-check we have a session then redirect
      const { data: userRes } = await supabase.auth.getUser();
      if (userRes?.user) {
        window.location.href = nextPath; // hard redirect so middleware sees session
      } else {
        setMsg('Signed in, but could not load session. Please refresh or try again.');
      }
    } catch (err: any) {
      console.error('[login] unexpected error:', err);
      setMsg(err?.message || 'Unexpected error.');
    } finally {
      setLoading(false);
    }
  }

  async function sendMagic(e: React.MouseEvent) {
    e.preventDefault();
    setMsg(null);
    const supabase = supabaseBrowser();

    try {
      if (!email) {
        setMsg('Enter your email first, then click the link button.');
        return;
      }
      const base = (typeof window !== 'undefined' ? window.location.origin : 'https://www.turnqa.com').replace(/\/+$/, '');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${base}/auth/callback?next=/dashboard&email=${encodeURIComponent(email)}`
        }
      });
      if (error) throw error;
      setMsg('We emailed you a one-click sign-in link.');
    } catch (err: any) {
      console.error('[login] magic link error:', err);
      setMsg(err?.message || 'Could not send magic link.');
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
            <label htmlFor="email" className="hint" style={{ fontSize: 12 }}>Email</label>
            <Input id="email" name="email" placeholder="you@example.com" type="email"
              value={email} onChange={e => setEmail(e.target.value)} required />

            <label htmlFor="password" className="hint" style={{ fontSize: 12 }}>Password</label>
            <Input id="password" name="password" placeholder="••••••••" type="password"
              value={password} onChange={e => setPassword(e.target.value)} required />

            <PrimaryButton disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </PrimaryButton>

            {msg && <p style={{ color: '#fda4af', fontSize: 14 }}>{msg}</p>}
          </form>

          {/* Magic link helper */}
          <button
            onClick={sendMagic}
            className="btn"
            style={{ marginTop: 10, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: '#111827', color: 'var(--text)', fontWeight: 600 }}
          >
            Email me a one-click sign-in link
          </button>

          {/* Legal */}
          <p className="hint" style={{ marginTop: 10, fontSize: 12 }}>
            By continuing, you agree to our{' '}
            <Link href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</Link>
            {' '}and{' '}
            <Link href="/legal/privacy" style={{ textDecoration: 'underline' }}>Privacy Policy</Link>.
          </p>

          {/* CTA */}
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
