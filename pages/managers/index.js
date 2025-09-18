// pages/managers/index.js
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Managers() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const page = {
    minHeight: '100vh',
    background: '#0b0b0f',
    color: '#e5e7eb',
    fontFamily: 'ui-sans-serif'
  };
  const wrap = { maxWidth: 780, margin: '0 auto', padding: '32px 16px' };
  const header = { textAlign: 'center', marginBottom: 18 };
  const title = { fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' };
  const card = {
    background: '#0f172a',
    border: '1px solid #1f2937',
    borderRadius: 16,
    padding: 20
  };
  const btnRow = { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 };
  const btnPrimary = {
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid #38bdf8',
    background: '#0ea5e9',
    color: '#0b0b0f',
    textDecoration: 'none',
    fontWeight: 600
  };
  const btnSecondary = {
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid #334155',
    background: '#111827',
    color: '#e5e7eb',
    textDecoration: 'none',
    fontWeight: 600
  };
  const muted = { color: '#9ca3af' };

  return (
    <div style={page}>
      <main style={wrap}>
        <header style={header}>
          <div style={title}>TurnQA</div>
        </header>

        <div style={card}>
          <h1 style={{ marginTop: 0, marginBottom: 6 }}>Managers — Admin &amp; Review</h1>
          <p style={muted}>New to TurnQA? Start a free trial. Already have an account? Sign in.</p>
          <div style={btnRow}>
            {session ? (
              <Link href="/dashboard" style={btnPrimary}>Go to dashboard</Link>
            ) : (
              <>
                <Link href="/auth/signin" style={btnPrimary}>Start free trial</Link>
                <Link href="/auth/signin" style={btnSecondary}>Manager sign in</Link>
              </>
            )}
          </div>
        </div>

        <div style={{ ...card, marginTop: 16 }}>
          <p style={muted}>
            After you sign in, you’ll land on your dashboard to create a property, build the photo checklist,
            invite cleaners, and review/approve turns.
          </p>
        </div>
      </main>
    </div>
  );
}
