import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

type Profile = {
  role?: 'manager' | 'cleaner' | string;
  first_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export default function Header() {
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();

    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setDisplayName(null);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, first_name, phone, email')
        .eq('id', session.user.id)
        .single();

      const role = (profile?.role || 'manager') as Profile['role'];

      const nameForCleaner =
        profile?.first_name || profile?.phone || session.user.user_metadata?.phone || session.user.email || 'Cleaner';

      const nameForManager = session.user.email || profile?.email || 'Manager';

      setDisplayName(role === 'cleaner' ? nameForCleaner : nameForManager);
    }

    load();

    // keep it fresh if auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange(() => load());
    return () => listener.subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        borderBottom: '1px solid var(--border)',
        background: 'rgba(11,11,13,0.6)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingTop: 14,
          paddingBottom: 14,
        }}
      >
        <Link
          href="/"
          aria-label="TurnQA home"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}
        >
          <Image src="/logo-camera.svg" alt="TurnQA" width={36} height={36} priority />
          <span style={{ fontWeight: 700, letterSpacing: 0.2 }}>TurnQA</span>
        </Link>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ opacity: 0.7, fontSize: 14 }}>Midnight</div>

          {displayName ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span
                className="muted"
                style={{
                  fontSize: 14,
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,.04)',
                }}
                title="Signed in"
              >
                {displayName}
              </span>
              <button
                onClick={signOut}
                className="btn"
                style={{ padding: '6px 10px', borderRadius: 12 }}
                aria-label="Sign out"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link href="/login" className="btn" style={{ padding: '6px 10px', borderRadius: 12 }}>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
