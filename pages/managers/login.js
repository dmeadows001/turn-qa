// pages/managers/login.js
import { useState } from 'react';
import { useRouter } from 'next/router';

export default function ManagerLogin() {
  const router = useRouter();
  const [pass, setPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/manager-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Login failed');
      router.replace('/managers');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f172a' }}>
      <form onSubmit={submit} style={{ background:'#fff', padding:24, borderRadius:12, width:'min(420px, 92vw)' }}>
        <h1 style={{ marginTop:0 }}>Managers Login</h1>
        <p style={{ marginTop:4, color:'#475569' }}>Enter the manager password to access admin pages.</p>
        <input
          type="password"
          value={pass}
          onChange={e=>setPass(e.target.value)}
          placeholder="Manager password"
          style={{ width:'100%', padding:'12px 10px', borderRadius:10, border:'1px solid #cbd5e1', fontSize:16 }}
        />
        {err && <div style={{ color:'#b91c1c', marginTop:8 }}>{err}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{ width:'100%', marginTop:12, padding:'12px 14px', fontWeight:700, fontSize:16,
                   background:'#0284c7', color:'#fff', border:'none', borderRadius:10, cursor:'pointer' }}
        >
          {loading ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </div>
  );
}
