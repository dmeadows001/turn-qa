// pages/auth/signin.js
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function SignIn() {
  const router = useRouter();
  const urlMode = (router.query?.mode || '').toString();
  const [mode, setMode] = useState(urlMode === 'signup' ? 'signup' : 'signin'); // 'signin' | 'signup'
  const [session, setSession] = useState(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (urlMode === 'signup' || urlMode === 'signin') setMode(urlMode);
  }, [urlMode]);

  useEffect(() => {
    if (session) router.replace('/dashboard');
  }, [session, router]);

  const redirectTo = useMemo(() => {
    if (typeof window !== 'undefined') return `${window.location.origin}/dashboard`;
    const base = process.env.NEXT_PUBLIC_APP_BASE_URL || process.env.APP_BASE_URL || 'https://www.turnqa.com';
    return `${base.replace(/\/+$/, '')}/dashboard`;
  }, []);

  async function doSignIn(e) {
    e.preventDefault();
    try {
      setMsg('');
      if (!email || !password) throw new Error('Enter your email and password.');
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setMsg('Signed in — redirecting…');
    } catch (err) {
      setMsg(err.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function doSignUp(e) {
    e.preventDefault();
    try {
      setMsg('');
      if (!email || !password) throw new Error('Enter an email and choose a password.');
      setLoading(true);
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { emailRedirectTo: redirectTo }
      });
      if (error) throw error;
      setMsg(data.session
        ? 'Account created — redirecting…'
        : 'Account created. If email confirmation is required, check your inbox and then sign in.');
    } catch (err) {
      setMsg(err.message || 'Sign-up failed');
    } finally {
      setLoading(false);
    }
  }

  async function sendMagicLink(e) {
    e.preventDefault();
    try {
      setMsg('');
      if (!email) throw new Error('Enter your email to receive a link.');
      setLoading(true);
      const { error } = await supabase.auth.signInWithOtp({
        email, options: { emailRedirectTo: redirectTo }
      });
      if (error) throw error;
      setMsg('We emailed you a one-click sign-in link.');
    } catch (err) {
      setMsg(err.message || 'Failed to send sign-in link');
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  // ---------- Dark theme + spacing ----------
  const page = {
    minHeight: '100vh',
    background: '#0b0b0f',
    color: '#e5e7eb',
    fontFamily: 'ui-sans-serif',
    display: 'grid',
    placeItems: 'center',
    padding: '32px 16px',
  };
  const wrap = { width: '100%', maxWidth: 560 };
  const header = { textAlign: 'center', marginBottom: 18 };
  const title = { fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em' };
  const card = {
    background: '#0f172a',
    border: '1px solid #1f2937',
    borderRadius: 16,
    padding: 20,
    maxWidth: '100%',
    overflow: 'hidden',
  };
  const tabs = { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' };
  const tab = (active) => ({
    flex: 1,
    textAlign: 'center',
    padding: '10px 12px',
    borderRadius: 10,
    cursor: 'pointer',
    fontWeight: 700,
    border: active ? '1px solid #38bdf8' : '1px solid #334155',
    background: active ? '#0ea5e9' : '#111827',
    color: active ? '#0b0b0f' : '#e5e7eb',
    boxSizing: 'border-box',
    minWidth: 120,
  });
  const label = { fontSize: 13, color: '#9ca3af', marginBottom: 6, display: 'block' };
  const input = {
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    minWidth: 0,
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid #334155',
    background: '#111827',
    color: '#e5e7eb',
    outline: 'none',
    marginBottom: 10,
  };
  const btnPrimary = {
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    marginTop: 10, // was 6 → add a bit more space
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid #38bdf8',
    background: '#0ea5e9',
    color: '#0b0b0f',
    textDecoration: 'none',
    fontWeight: 700,
    cursor: 'pointer',
  };
  const row = { display: 'flex', gap: 8, flexWrap: 'wrap' };
  const btnAlt = {
    flex: 1,
    minWidth: 180,
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid #334155',
    background: '#111827',
    color: '#e5e7eb',
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center',
    textDecoration: 'none',
    boxSizing: 'border-box',
  };
  const muted = { color: '#9ca3af' };
  const helper = { color: '#9ca3af', fontSize: 12, marginTop: 14 }; // was 6 → more breathing room
  const linky = { color: '#93c5fd', textDecoration: 'underline', cursor: 'pointer', marginLeft: 6 };
  const footer = { textAlign: 'center', marginTop: 16, color: '#6b7280', fontSize: 13 };

  return (
    <div style={page}>
      <div style={wrap}>
        <header style={header}>
          <div style={title}>TurnQA</div>
        </header>

        <div style={card}>
          {session ? (
            <>
              <h2 style={{ marginTop: 0, marginBottom: 8 }}>You’re signed in 🎉</h2>
              <p style={muted}>Go to your dashboard to create a property, build your photo checklist, and invite a cleaner.</p>
              <div style={{ ...row, marginTop: 14 }}>
                <Link href="/dashboard" style={{ ...btnPrimary, flex: 1, textAlign: 'center' }}>Go to dashboard</Link>
                <button onClick={signOut} style={{
                  ...btnAlt,
                  border: '1px solid #ef4444',
                  background: '#fee2e2',
                  color: '#111827'
                }}>Sign out</button>
              </div>
            </>
          ) : (
            <>
              <div style={tabs}>
                <button onClick={() => setMode('signin')} style={tab(mode === 'signin')}>Sign in</button>
                <button onClick={() => setMode('signup')} style={tab(mode === 'signup')}>Create account</button>
              </div>

              {mode === 'signin' ? (
                <>
                  <form onSubmit={doSignIn}>
                    <label style={label} htmlFor="email">Email</label>
                    <input id="email" type="email" placeholder="you@example.com" style={input}
                      value={email} onChange={e => setEmail(e.target.value)} />

                    <label style={label} htmlFor="password">Password</label>
                    <input id="password" type="password" placeholder="••••••••" style={input}
                      value={password} onChange={e => setPassword(e.target.value)} />

                    <button type="submit" disabled={loading} style={btnPrimary}>
                      {loading ? 'Signing in…' : 'Sign in'}
                    </button>
                  </form>

                  <div style={helper}>
                    Prefer not to type a password?
                    <a href="#" onClick={sendMagicLink} style={linky}>
                      Email me a one-click sign-in link
                    </a>
                    . (We’ll send it to the email above.)
                  </div>

                  <div style={{ ...row, marginTop: 16 }}>
                    <a href="/" style={btnAlt}>Back to home</a>
                  </div>
                </>
              ) : (
                <>
                  <form onSubmit={doSignUp}>
                    <label style={label} htmlFor="email">Email</label>
                    <input id="email" type="email" placeholder="you@example.com" style={input}
                      value={email} onChange={e => setEmail(e.target.value)} />

                    <label style={label} htmlFor="password">Password</label>
                    <input id="password" type="password" placeholder="Choose a secure password" style={input}
                      value={password} onChange={e => setPassword(e.target.value)} />

                    <button type="submit" disabled={loading} style={btnPrimary}>
                      {loading ? 'Creating…' : 'Create account'}
                    </button>
                  </form>

                  <div style={{ ...row, marginTop: 16 }}>
                    <a href="/" style={btnAlt}>Back to home</a>
                  </div>
                </>
              )}

              {msg && (
                <div style={{ marginTop: 12, color: msg.match(/link|Signed in|created|redirecting/i) ? '#22c55e' : '#fca5a5' }}>
                  {msg}
                </div>
              )}
            </>
          )}
        </div>

        <div style={footer}>
          © {new Date().getFullYear()} TurnQA
        </div>
      </div>
    </div>
  );
}
