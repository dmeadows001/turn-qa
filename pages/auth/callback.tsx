// pages/auth/callback.tsx
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

function enc(v: unknown) {
  return encodeURIComponent(String(v ?? ''));
}

export default function AuthCallback() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [msg, setMsg] = useState('Completing sign-in…');

  useEffect(() => {
    const run = async () => {
      const rawNext = (router.query.next as string | undefined) || '/dashboard';
      const next = rawNext && typeof rawNext === 'string' ? rawNext : '/dashboard';

      // Parse hash params from magic link
      const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
      const params = new URLSearchParams(hash);

      // Clear the hash (prevents re-running on refresh)
      if (typeof window !== 'undefined') {
        const clean = window.location.pathname + window.location.search;
        window.history.replaceState(null, '', clean);
      }

      const err = params.get('error');
      const errCode = params.get('error_code');
      const errDesc = params.get('error_description');

      if (err || errCode) {
        router.replace(`/login?next=${enc(next)}&reason=${enc(errCode || err)}&msg=${enc(errDesc || 'Link invalid or expired')}`);
        return;
      }

      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');

      try {
        if (access_token && refresh_token) {
          setMsg('Finalizing session…');

          // Race setSession with a timeout so we don’t hang forever
          const setPromise = supabase.auth.setSession({ access_token, refresh_token });
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('setSession timeout')), 3500)
          );

          try {
            await Promise.race([setPromise, timeout]);
          } catch (e) {
            // swallow; we’ll verify with getSession() below
            console.warn('[callback] setSession race error:', e);
          }

          // Verify whether a session actually exists
          const { data, error } = await supabase.auth.getSession();
          if (error) console.warn('[callback] getSession error:', error);

          if (data?.session) {
            // Best-effort profile setup (non-blocking)
            fetch('/api/ensure-profile', { method: 'POST' }).catch(() => {});
            router.replace(next);
            return;
          }

          // No session after setSession attempt → send to login with context
          router.replace(`/login?next=${enc(next)}&reason=${enc('no_session_after_set')}`);
          return;
        }

        // No tokens in hash: maybe already signed in?
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          router.replace(next);
          return;
        }

        router.replace(`/login?next=${enc(next)}&reason=${enc('no_tokens')}`);
      } catch (e: any) {
        console.error('[callback] fatal error', e);
        router.replace(`/login?next=${enc(next)}&reason=${enc('callback_error')}&msg=${enc(e?.message || 'Unknown error')}`);
      }
    };

    run();
  }, [router, supabase]);

  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#0b0b0f', color:'#e5e7eb', fontFamily:'ui-sans-serif' }}>
      <div style={{ background:'#0f172a', border:'1px solid #1f2937', borderRadius:16, padding:20, minWidth:280, textAlign:'center' }}>
        {msg}
      </div>
    </div>
  );
}
