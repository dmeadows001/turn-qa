import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import Link from 'next/link';

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
    <main className="min-h-screen bg-black text-white grid place-items-center p-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl p-6">
        <h1 className="text-2xl font-semibold mb-4">Start Free 30-Day Trial</h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <input className="w-full rounded-xl bg-black/40 border border-white/10 p-3"
                 placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <input className="w-full rounded-xl bg-black/40 border border-white/10 p-3"
                 placeholder="Create password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          <button className="w-full rounded-2xl bg-white/10 hover:bg-white/20 py-3" disabled={loading}>
            {loading ? 'Creating…' : 'Create Account'}
          </button>
          {msg && <p className="text-red-400 text-sm">{msg}</p>}
        </form>
        <p className="mt-4 text-sm opacity-80">
          Already have an account? <Link href="/login" className="underline">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
