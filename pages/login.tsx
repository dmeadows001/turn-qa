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
    <main className="centered">
      <Card className="w-full max-w-md">
        <h1 className="h1">Manager Sign In</h1>
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
          <Input placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <Input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          <PrimaryButton disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</PrimaryButton>
          {msg && <p style={{ color: '#fda4af', fontSize: 14 }}>{msg}</p>}
        </form>
        <p className="hint" style={{ marginTop: 10 }}>
          New here? <Link href="/signup" style={{ textDecoration: 'underline', color: 'var(--text)' }}>Start your free trial</Link>
        </p>
      </Card>
    </main>
  );
}
