// pages/auth/signin.js
import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendLink() {
    try {
      setMsg('');
      setLoading(true);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` }
      });
      if (error) throw error;
      setMsg('Check your email for a sign-in link.');
    } catch (e) {
      setMsg(e.message || 'Failed to send link');
    } finally {
      setLoading(false);
    }
  }

  const wrap = { maxWidth: 460, margin: '60px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const input = { width:'100%', padding:10, borderRadius:8, border:'1px solid #cbd5e1', marginBottom:12 };
  const btn = { padding:'10px 14px', borderRadius:10, border:'1px solid #0ea5e9', background:'#e0f2fe', cursor:'pointer' };

  return (
    <main style={wrap}>
      <h1>Sign in to TurnQA</h1>
      <p>We’ll email you a magic link.</p>
      <input style={input} placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} />
      <button disabled={loading} onClick={sendLink} style={btn}>{loading ? 'Sending…' : 'Send link'}</button>
      {msg && <div style={{marginTop:12}}>{msg}</div>}
      <div style={{marginTop:16}}><a href="/">← Back to home</a></div>
    </main>
  );
}
