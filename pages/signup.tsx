import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';

export default function Signup() {
  const [email, setEmail] = useState(''); 
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) setMsg(error.message);
    else window.location.href = '/managers/turns';
  }

  return (
    <main className="centered">
      <Card className="w-full max-w-md">
        <h1 className="h1">Start Free 30-Day Trial</h1>
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
          <Input placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <Input placeholder="Create password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          <PrimaryButton disabled={loading}>{loading ? 'Creating…' : 'Create Account'}</PrimaryButton>
          {msg && <p style={{ color: '#fda4af', fontSize: 14 }}>{msg}</p>}
        </form>
        <p className="hint" style={{ marginTop: 10 }}>
          Already have an account? <Link href="/login" style={{ textDecoration: 'underline', color: 'var(--text)' }}>Sign in</Link>
        </p>
      </Card>
    </main>
  );
}
