// components/UserMenu.js
import { useEffect, useState } from 'react';
import { ui } from '../lib/theme';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function UserMenu() {
  const supabase = supabaseBrowser();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data?.session || null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [supabase]);

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } finally {
      // Always bounce to home after sign-out
      window.location.href = '/';
    }
  }

  if (loading) return null;

  // Not signed in: show a subtle Sign in link (or return null if you prefer)
  if (!session) {
    return (
      <a href="/auth/signin" style={{ ...ui.btnSecondary, padding: '6px 10px' }}>
        Sign in
      </a>
    );
  }

  const email = session?.user?.email || 'Account';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12, opacity: 0.7 }}>{email}</span>
      <button onClick={signOut} style={{ ...ui.btnSecondary, padding: '6px 10px' }}>
        Sign out
      </button>
    </div>
  );
}
