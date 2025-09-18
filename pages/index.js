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

  const wrap  = { maxWidth: 1000, margin: '40px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const hero  = { display:'grid', gap:16, gridTemplateColumns:'1fr', marginTop:12 };
  const card  = { border:'1px solid #e5e7eb', borderRadius:16, padding:20, background:'#fff' };
  const btnP  = { padding:'12px 16px', borderRadius:12, border:'1px solid #0ea5e9', background:'#e0f2fe', textDecoration:'none', display:'inline-block' };
  const btnS  = { padding:'12px 16px', borderRadius:12, border:'1px solid #94a3b8', background:'#f8fafc', textDecoration:'none', display:'inline-block' };
  const muted = { color:'#475569' };

  return (
    <main style={wrap}>
      <h1>TurnQA</h1>
      <p style={{...muted, marginTop:6}}>Photo-verified turnovers for short-term rentals.</p>

      <section style={hero}>
        <div style={card}>
          <h2 style={{ marginTop:0 }}>Managers</h2>
          <p style={muted}>New here? Start a free trial. Already using TurnQA? Sign in.</p>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:8 }}>
            {session ? (
              <Link href="/dashboard" style={btnP}>Go to dashboard</Link>
            ) : (
              <>
                <Link href="/auth/signin" style={btnP}>Start free trial</Link>
                <Link href="/auth/signin" style={btnS}>Manager sign in</Link>
              </>
            )}
          </div>
        </div>

        <div style={card}>
          <h2 style={{ marginTop:0 }}>Cleaners</h2>
          <p style={muted}>
            Cleaners don’t create accounts here. You’ll get a secure SMS invite from your manager.
            Open the link in that text to verify your phone and start a job.
          </p>
        </div>

        <div style={card}>
          <h2 style={{ marginTop:0 }}>How it works</h2>
          <ol style={{ margin:'8px 0 0 18px' }}>
            <li>Start free trial &rarr; create a property template (photo checklist).</li>
            <li>Invite a cleaner by SMS.</li>
            <li>Cleaner uploads photos via the capture link.</li>
            <li>Manager reviews & approves. (Optional: auto-payout.)</li>
          </ol>
        </div>
      </section>
    </main>
  );
}
