// pages/login.tsx
import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import Header from '@/components/layout/Header';
import Image from 'next/image';

export default function Login() {
  const router = useRouter();
  const nextDest = (router.query.next as string) || '/dashboard';
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setMsg(error.message);
    else window.location.href = nextDest; // ✅ go to dashboard (or ?next=…)
  }

  async function sendMagicLink(e: React.MouseEvent) {
    e.preventDefault();
    if (!email) { setMsg('Enter your email to receive a sign-in link.'); return; }
    setSendingLink(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // 🔑 magic link returns to the same callback on WWW host
        emailRedirectTo: 'https://www.turnqa.com/auth/callback?next=/dashboard',
      },
    });
    setSendingLink(false);
    setMsg(error ? error.message : 'We emailed you a one-click sign-in link.');
  }

// inside Login component
async function sendPasswordReset(e?: React.MouseEvent) {
  e?.preventDefault?.();
  try {
    setMsg('');
    if (!email) {
      setMsg('Enter your email above, then click “Reset password”.');
      return;
    }

    const base =
      (typeof window !== 'undefined'
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
    setMsg(err.message || 'Could not send reset email.');
  }
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

          <h1 className="h1 accent" style={{ marginBottom: 18 }}>Sign in</h1>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
            <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <Input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            <PrimaryButton disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</PrimaryButton>
            {msg && <p style={{ color: msg.includes('emailed') ? '#22c55e' : '#fda4af', fontSize: 14 }}>{msg}</p>}
          </form>

          {/* Magic link option */}
          <p className="hint" style={{ marginTop: 10 }}>
            Prefer not to type a password?
            <a href="#" onClick={sendMagicLink} style={{ marginLeft: 6, textDecoration: 'underline' }}>
              {sendingLink ? 'Sending link…' : 'Email me a one-click sign-in link'}
            </a>
            .
          </p>

          {/* Legal */}
          <p className="hint" style={{ marginTop: 10, fontSize: 12 }}>
            By continuing, you agree to our <Link href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</Link> and{' '}
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
