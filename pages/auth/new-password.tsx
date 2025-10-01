// pages/auth/new-password.tsx
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

type Stage = 'initializing' | 'ready' | 'updating' | 'done' | 'error';

export default function NewPassword() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [stage, setStage] = useState<Stage>('initializing');
  const [email, setEmail] = useState<string>('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  // Pull (?next=/...) for where to go after success
  const nextPath = useMemo(() => {
    const raw = (router.query?.next as string) || '/dashboard';
    try { return decodeURIComponent(raw); } catch { return '/dashboard'; }
  }, [router.query?.next]);

  // 1) On mount, read hash tokens and establish a session
  useEffect(() => {
    (async () => {
      try {
        setMsg('Finalizing link…');

        // Hash looks like: #access_token=...&refresh_token=...&type=recovery&...
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        const params = new URLSearchParams(hash.replace(/^#/, ''));

        const access_token  = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        const type          = params.get('type'); // 'recovery' for reset, but could be 'magiclink'

        // If tokens exist, set session; else try to use any existing session (e.g., user already logged in)
        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          setEmail(data.session?.user?.email || '');
          setStage('ready');
          setMsg(null);
          // clear hash (nice-to-have)
          window.history.replaceState({}, '', window.location.pathname + window.location.search);
        } else {
          // No tokens in hash — check if we already have a session
          const { data: sess } = await supabase.auth.getSession();
          if (sess.session?.user) {
            setEmail(sess.session.user.email || '');
            setStage('ready');
            setMsg(null);
          } else {
            setStage('error');
            setMsg('This link is missing credentials or has expired. Request a new reset link from the sign-in page.');
          }
        }
      } catch (e: any) {
        setStage('error');
        setMsg(e?.message || 'Could not finalize the link.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Submit new password
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMsg(null);
      if (!pw1 || pw1.length < 8) {
        setMsg('Password must be at least 8 characters.'); return;
      }
      if (pw1 !== pw2) {
        setMsg('Passwords do not match.'); return;
      }
      setStage('updating');
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;

      setStage('done');
      setMsg('Password updated. Redirecting…');
      // give the user a moment to read the message
      setTimeout(() => router.replace(nextPath), 800);
    } catch (e: any) {
      setStage('ready');
      setMsg(e?.message || 'Could not update password.');
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
          <h1 className="h1 accent" style={{ marginBottom: 12 }}>
            {stage === 'initializing' ? 'Finalizing link…' :
             stage === 'done' ? 'All set!' :
             'Set a new password'}
          </h1>

          {stage === 'initializing' ? (
            <p className="hint">Please wait…</p>
          ) : stage === 'error' ? (
            <>
              <p style={{ color: '#fda4af', marginBottom: 10 }}>{msg}</p>
              <p className="hint">
                Back to{' '}
                <Link href="/login" style={{ textDecoration: 'underline' }}>
                  Sign in
                </Link>
              </p>
            </>
          ) : stage === 'done' ? (
            <p className="hint">{msg || 'Password updated.'}</p>
          ) : (
            <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
              {email && (
                <div className="hint" style={{ fontSize: 13, opacity: 0.9 }}>
                  Resetting password for <b>{email}</b>
                </div>
              )}

              <Input
                id="pw1"
                type="password"
                placeholder="New password"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                required
              />
              <Input
                id="pw2"
                type="password"
                placeholder="Confirm new password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                required
              />

              <PrimaryButton disabled={stage === 'updating'}>
                {stage === 'updating' ? 'Updating…' : 'Update password'}
              </PrimaryButton>

              {msg && (
                <p style={{ color: msg.toLowerCase().includes('updated') ? '#22c55e' : '#fda4af', fontSize: 14 }}>
                  {msg}
                </p>
              )}

              <p className="hint" style={{ marginTop: 10, fontSize: 12 }}>
                Having trouble?{' '}
                <Link href="/login" style={{ textDecoration: 'underline' }}>
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </Card>
      </main>
    </>
  );
}
