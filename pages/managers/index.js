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

  const wrap = { maxWidth: 720, margin: '40px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const card = { border:'1px solid #e5e7eb', borderRadius:16, padding:20, background:'#fff' };
  const btnP = { padding:'12px 16px', borderRadius:12, border:'1px solid #0ea5e9', background:'#e0f2fe', textDecoration:'none', display:'inline-block' };
  const btnS = { padding:'12px 16px', borderRadius:12, border:'1px solid #94a3b8', background:'#f8fafc', textDecoration:'none', display:'inline-block' };
  const muted= { color:'#475569' };

  return (
    <main style={wrap}>
      <h1>Managers — Admin &amp; Review</h1>
      <div style={card}>
        <p style={muted}>New to TurnQA? Start a free trial. Already have an account? Sign in.</p>
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

      <div style={{ ...card, marginTop: 16 }}>
        <p style={muted}>After you sign in, you’ll land on your dashboard to create a property, build the photo checklist, invite cleaners, and review/approve turns.</p>
      </div>
    </main>
  );
}
