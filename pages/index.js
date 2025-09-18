// pages/index.js
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Home() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const page = {
    minHeight: '100vh',
    background: '#0b0b0f',     // almost-black
    color: '#e5e7eb',          // slate-200
    fontFamily: 'ui-sans-serif'
  };
  const wrap = { maxWidth: 1040, margin: '0 auto', padding: '32px 16px' };
  const header = { textAlign: 'center', marginBottom: 18 };
  const title = {
    fontSize: 36,
    fontWeight: 800,
    letterSpacing: '-0.02em'
  };
  const subtitle = { color: '#9ca3af', marginTop: 6 };
  const grid = {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: '1fr'
  };
  const card = {
    background: '#0f172a',     // slate-900
    border: '1px solid #1f2937',
    borderRadius: 16,
    padding: 20
  };
  const btnRow = { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 };
  const btnPrimary = {
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid #38bdf8',   // sky-400
    background: '#0ea5e9',         // sky-500
    color: '#0b0b0f',
    textDecoration: 'none',
    fontWeight: 600
  };
  const btnSecondary = {
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid #334155',   // slate-700
    background: '#111827',         // gray-900
    color: '#e5e7eb',
    textDecoration: 'none',
    fontWeight: 600
  };
  const muted = { color: '#9ca3af' };
  const list = { margin: '8px 0 0 18px', color: '#cbd5e1' };
  const footer = { textAlign: 'center', marginTop: 24, color: '#6b7280', fontSize: 13 };

  return (
    <div style={page}>
      <main style={wrap}>
        <header style={header}>
          <div style={title}>TurnQA</div>
          <div style={subtitle}>Photo-verified turnovers for short-term rentals.</div>
        </header>

        <section style={grid}>
          <div style={card}>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Managers</h2>
            <p style={muted}>New here? Start a free trial. Already using TurnQA? Sign in.</p>
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

          <div style={card}>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Cleaners</h2>
            <p style={muted}>
              Cleaners don’t create accounts here. You’ll receive a secure SMS invite from your manager.
              Open that link to verify and start a job.
            </p>
          </div>

          <div style={card}>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>How it works</h2>
            <ol style={list}>
              <li>Start free trial → create a property & photo checklist.</li>
              <li>Invite a cleaner by SMS.</li>
              <li>Cleaner uploads photos via the capture link.</li>
              <li>Manager reviews & approves. (Optional: auto-payout.)</li>
            </ol>
          </div>
        </section>

        <div style={footer}>
          © {new Date().getFullYear()} TurnQA
        </div>
      </main>
    </div>
  );
}
