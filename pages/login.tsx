import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setMsg(error.message);
    else window.location.href = '/managers/turns';
  }

  return (
    <main
      className="auth-wrap"
      style={{
        minHeight: '100vh',
        background:
          'var(--bg), radial-gradient(1000px 600px at 80% -10%, rgba(124,92,255,.16), transparent 60%), radial-gradient(800px 500px at 0% 100%, rgba(0,229,255,.08), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%)'
      }}
    >
      <Card className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-badge" />
          <div className="muted" style={{ fontWeight: 600 }}>TurnQA • Manager</div>
        </div>

        <h1 className="h1 accent" style={{ marginBottom: 18 }}>Sign in</h1>

        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
          <Input
            placeholder="Email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <Input
            placeholder="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <PrimaryButton disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </PrimaryButton>
          {msg && <p style={{ color: '#fda4af', fontSize: 14 }}>{msg}</p>}
        </form>

        <p className="hint" style={{ marginTop: 14 }}>
          New here?{' '}
          <Link href="/signup" style={{ textDecoration: 'underline', color: 'var(--text)' }}>
            Start your free trial
          </Link>
        </p>
      </Card>
    </main>
  );
}
