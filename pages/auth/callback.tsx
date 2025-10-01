// pages/auth/callback.tsx
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function AuthCallback() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [msg, setMsg] = useState('Completing sign-in…');

  useEffect(() => {
    const run = async () => {
      try {
        // 1) Where to send the user after we finish
        const next = (router.query.next as string) || '/dashboard';

        // 2) Read tokens from URL hash (magic link / oauth)
        const hash = window.location.hash.replace(/^#/, '');
        const params = new URLSearchParams(hash);

        const access_token  = params.get('access_token');
        const refresh_token = params.get('refresh_token');

        if (!access_token || !refresh_token) {
          // If there are no tokens in the hash, we might already have a session
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            setMsg('Session already present — redirecting…');
            router.replace(next);
            return;
          }
          // Otherwise, bounce to login with a hint
          router.replace(`/login?next=${encodeURIComponent(next)}&reason=no_tokens`);
          return;
        }

        // 3) Write session to Supabase (this also sets the cookies)
        setMsg('Finalizing session…');
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) throw error;

        // 4) Optional: ensure profile/trial row server-side (non-blocking)
        fetch('/api/ensure-profile', { method: 'POST' }).catch(() => {});

        // 5) Go!
        router.replace(next);
      } catch (err: any) {
        setMsg(err?.message || 'Could not complete sign-in');
        // Failsafe: get them back to login after a short pause
        setTimeout(() => {
          const next = (router.query.next as string) || '/dashboard';
          router.replace(`/login?next=${encodeURIComponent(next)}`);
        }, 1200);
      }
    };

    run();
  }, [router, supabase]);

  return (
    <div style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      background: '#0b0b0f', color: '#e5e7eb', fontFamily: 'ui-sans-serif'
    }}>
      <div style={{
        background: '#0f172a', border: '1px solid #1f2937',
        borderRadius: 16, padding: 20, minWidth: 280, textAlign: 'center'
      }}>
        {msg}
      </div>
    </div>
  );
}
