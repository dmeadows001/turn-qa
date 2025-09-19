// pages/index.js
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import ChromeDark from '../components/ChromeDark';
import { ui } from '../lib/theme';

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

  return (
    <ChromeDark title="TurnQA">
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Managers</h2>
          <p style={ui.muted}>New here? Start a free trial. Already using TurnQA? Sign in.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {session ? (
              <Link href="/dashboard" style={{ ...ui.btnPrimary, textAlign: 'center' }}>
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link href="/auth/signin?mode=signup" style={ui.btnPrimary}>Start free trial</Link>
                <Link href="/auth/signin?mode=signin" style={ui.btnSecondary}>Manager sign in</Link>
              </>
            )}
          </div>
        </div>

        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Cleaners</h2>
          <p style={ui.muted}>
            Cleaners don’t create accounts here. You’ll receive a secure SMS invite from your manager.
            Open that link to verify and start a job.
          </p>
        </div>

        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>How it works</h2>
          <ol style={{ margin: '8px 0 0 18px', color: '#cbd5e1' }}>
            <li>Start free trial → create a property & photo checklist.</li>
            <li>Invite a cleaner by SMS.</li>
            <li>Cleaner uploads photos via the capture link.</li>
            <li>Manager reviews & approves. (Optional: auto-payout.)</li>
          </ol>
        </div>
      </section>
    </ChromeDark>
  );
}
