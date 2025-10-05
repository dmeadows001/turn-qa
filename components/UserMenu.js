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
      window.location.href = '/';
    }
  }

  if (loading) return null;

  // Not signed in: show Sign in (or return null to hide)
  if (!session) {
    return (
      <a href="/auth/signin" style={{ ...ui.btnSecondary, padding: '6px 10px' }}>
        Sign in
      </a>
    );
  }

  // Signed in: show only a Sign out button (no email/PII)
  return (
    <button onClick={signOut} style={{ ...ui.btnSecondary, padding: '6px 10px' }}>
      Sign out
    </button>
  );
}
