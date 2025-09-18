// pages/auth/signin.js
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function SignIn() {
  const [session, setSession] = useState(null);
  const [email, setEmail]     = useState('');
  const [msg, setMsg]         = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function sendMagicLink(e) {
    e.preventDefault();
    try {
      setMsg('');
      if (!email) throw new Error('Please enter your email.');
      setSending(true);

      // Send a magic link. New users = free trial signup; existing users = sign-in.
      const redirectTo =
        (typeof window !== 'undefined'
          ? `${window.location.origin}/dashboard`
          : (process.env.NEXT_PUBLIC_APP_BASE_URL || process.env.APP_BASE_URL || 'https://www.turnqa.com') + '/dashboard');

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo }
      });
      if (error) throw error;

      setMsg('Check your email for the sign-in link.');
    } catch (err) {
      setMsg(err.message || 'Failed to send magic link');
    } finally {
      setSending(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  // ----- dark theme styles (same palette as your new home/managers pages) -----
  const page = {
    minHeight: '100vh',
    background: '#0b0b0f',
    color: '#e5e7eb',
    fontFamily: 'ui-sans-serif',
    display: 'grid',
    placeItems: 'center',
    padding: '32px 16px'
  };
  const wrap = { width: '100%', maxWidth: 560 };
  const header = { textAlign: 'center', marginBottom: 18 };
  const title = { fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em' };
  const card = {
    background: '#0f172a',
    border: '1px solid #1f2937',
    borderRadius: 16,
    padding: 20
  };
  const label = { fontSize: 13, color: '#9ca3af', marginBottom: 6, display: 'block' };
  const input = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid #334155',
    background: '#111827',
    color: '#e5e7eb',
    outline: 'none'
  };
  const btnPrimary = {
    width: '100%',
    marginTop: 12,
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid #38bdf8',
    background: '#0ea5e9',
    color: '#0b0b0f',
    textDecoration: 'none',
    fontWeight: 700,
    cursor: 'pointer'
  };
  const muted = { color: '#9ca3af' };
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
              <p style={muted}>Head to your dashboard to create a property, build your photo checklist, and invite a cleaner.</p>
              <div style={{ display:'flex', gap:8, marginTop: 12 }}>
                <Link href="/dashboard" style={{
                  flex:1, textAlign:'center', ...btnPrimary
                }}>Go to dashboard</Link>
                <button onClick={signOut} style={{
                  flex:1,
                  padding: '12px 16px',
                  borderRadius: 12,
                  border: '1px solid #ef4444',
                  background: '#fee2e2',
                  color: '#111827',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}>Sign out</button>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ marginTop: 0, marginBottom: 8 }}>Start free trial / Sign in</h2>
              <p style={muted}>Enter your email to receive a magic link. New users will start a free trial automatically.</p>
              <form onSubmit={sendMagicLink}>
                <label style={label} htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  style={input}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
                <button type="submit" disabled={sending} style={btnPrimary}>
                  {sending ? 'Sending…' : 'Send magic link'}
                </button>
              </form>
              {msg && (
                <div style={{ marginTop: 12, color: msg.includes('Check your email') ? '#22c55e' : '#fca5a5' }}>
                  {msg}
                </div>
              )}
            </>
          )}
        </div>

        <div style={footer}>
          <Link href="/" style={{ color: '#9ca3af' }}>← Back to home</Link>
        </div>
      </div>
    </div>
  );
}
