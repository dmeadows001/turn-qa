// pages/auth/smoke.tsx
import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function AuthSmoke() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [out, setOut] = useState<any>(null);

  const callback = 'https://www.turnqa.com/auth/callback?next=/dashboard';

  async function checkSession() {
    const s = await supabase.auth.getSession();
    setOut({ where: 'getSession', ...s });
  }

  async function sendMagic() {
    if (!email) return setOut({ error: 'Enter email first' });
    const resp = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback }
    });
    setOut({ where: 'signInWithOtp', ...resp });
  }

  async function signInPassword() {
    if (!email || !password) return setOut({ error: 'Enter email & password' });
    const resp = await supabase.auth.signInWithPassword({ email, password });
    setOut({ where: 'signInWithPassword', ...resp });
  }

  async function signOut() {
    const resp = await supabase.auth.signOut();
    setOut({ where: 'signOut', ...resp });
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      background: '#0b0b0f', color: '#e5e7eb', fontFamily: 'ui-sans-serif'
    }}>
      <div style={{ width: 700, maxWidth: '90vw' }}>
        <h1 style={{ marginTop: 0 }}>Auth Smoke Test</h1>

        <div style={{ marginBottom: 8, fontSize: 14, opacity: .8 }}>
          Callback we will use: <code>{callback}</code>
        </div>

        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginBottom: 10 }}>
          <input
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ padding: 10, borderRadius: 8, border: '1px solid #334155', background: '#111827', color: '#e5e7eb' }}
          />
          <input
            placeholder="password (for password test)"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ padding: 10, borderRadius: 8, border: '1px solid #334155', background: '#111827', color: '#e5e7eb' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button onClick={checkSession} style={btn()}>Check session</button>
          <button onClick={sendMagic} style={btn('#38bdf8','#0ea5e9')}>Send magic link</button>
          <button onClick={signInPassword} style={btn('#a78bfa','#7c3aed')}>Sign in (password)</button>
          <button onClick={signOut} style={btn('#fca5a5','#ef4444')}>Sign out</button>
        </div>

        <pre style={{
          whiteSpace: 'pre-wrap',
          background: '#0f172a',
          border: '1px solid #1f2937',
          borderRadius: 12,
          padding: 12,
          fontSize: 12,
          maxHeight: 380,
          overflow: 'auto'
        }}>
{JSON.stringify(out, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function btn(border = '#334155', bg = '#111827') {
  return {
    padding: '10px 14px',
    borderRadius: 10,
    border: `1px solid ${border}`,
    background: bg,
    color: '#0b0b0f' === bg ? '#e5e7eb' : '#e5e7eb',
    fontWeight: 700,
    cursor: 'pointer'
  } as React.CSSProperties;
}
