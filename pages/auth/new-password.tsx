// pages/auth/new-password.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function NewPassword() {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [phase, setPhase] = useState<'init'|'ready'|'saving'|'done'|'error'>('init');
  const [msg, setMsg] = useState<string>('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');

  // 1) Capture tokens from the hash and set the session
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (!hash) { setMsg('Missing token in URL.'); setPhase('error'); return; }

    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) {
      setMsg('Invalid or expired link.');
      setPhase('error');
      return;
    }

    (async () => {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) {
        setMsg(error.message || 'Could not establish session from link.');
        setPhase('error');
        return;
      }
      setPhase('ready');
    })();
  }, []);

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pw || pw !== pw2) { setMsg('Passwords do not match.'); return; }
    setPhase('saving');
    setMsg('');

    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setMsg(error.message || 'Could not set password.');
      setPhase('ready');
      return;
    }

    setPhase('done');
    setTimeout(() => router.replace('/dashboard'), 800);
  }

  if (phase === 'init' || phase === 'saving') {
    return <main style={{display:'grid',placeItems:'center',minHeight:'60vh',color:'#e5e7eb'}}>Finalizing link…</main>;
  }

  if (phase === 'error') {
    return (
      <main style={{display:'grid',placeItems:'center',minHeight:'60vh',color:'#e5e7eb'}}>
        <div style={{maxWidth:420}}>
          <h1>Link problem</h1>
          <p style={{color:'#fca5a5'}}>{msg}</p>
          <a href="/login" style={{textDecoration:'underline'}}>Back to sign in</a>
        </div>
      </main>
    );
  }

  if (phase === 'done') {
    return <main style={{display:'grid',placeItems:'center',minHeight:'60vh',color:'#e5e7eb'}}>Password updated — redirecting…</main>;
  }

  // phase === 'ready'
  return (
    <main style={{display:'grid',placeItems:'center',minHeight:'60vh',color:'#e5e7eb'}}>
      <form onSubmit={submitNewPassword} style={{width:360,display:'grid',gap:12}}>
        <h1>Set a new password</h1>
        <input
          type="password"
          placeholder="New password"
          value={pw}
          onChange={e=>setPw(e.target.value)}
          style={{padding:'12px 14px',borderRadius:10,border:'1px solid #334155',background:'#111827',color:'#e5e7eb'}}
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={pw2}
          onChange={e=>setPw2(e.target.value)}
          style={{padding:'12px 14px',borderRadius:10,border:'1px solid #334155',background:'#111827',color:'#e5e7eb'}}
        />
        <button type="submit" style={{padding:'12px 16px',borderRadius:10,border:'1px solid #38bdf8',background:'#0ea5e9',color:'#0b0b0f',fontWeight:700}}>
          Save password
        </button>
        {msg && <div style={{color:'#fca5a5'}}>{msg}</div>}
      </form>
    </main>
  );
}
