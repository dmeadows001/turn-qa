// components/UserMenu.tsx
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function UserMenu() {
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // initial read
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setEmail(data.session?.user?.email ?? null);
    });

    // stay in sync
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } finally {
      // Always bounce to home whether or not signOut throws
      window.location.href = '/';
    }
  }

  if (!email) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 14,
        color: '#e5e7eb',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ opacity: 0.9 }}>Signed in as</span>
      <strong style={{ fontWeight: 600 }}>{email}</strong>
      <button
        onClick={signOut}
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid #374151',
          background: '#111827',
          color: '#e5e7eb',
          cursor: 'pointer',
        }}
      >
        Sign out
      </button>
    </div>
  );
}
