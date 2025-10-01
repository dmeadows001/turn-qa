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
      const rawNext = (router.query.next as string | undefined) || '/dashboard';
      const next = typeof rawNext === 'string' && rawNext.length ? rawNext : '/dashboard';

      // Read URL hash
      const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
      const params = new URLSearchParams(hash);

      // Error from Supabase (e.g., otp_expired)
      const err = params.get('error');
      const errCode = params.get('error_code');
      const errDesc = params.get('error_description');

      if (err || errCode) {
        const qNext   = encodeURIComponent(next);
        const qReason = encodeURIComponent(String(errCode || err || 'unknown'));
        const qMsg    = encodeURIComponent(String(errDesc || 'Link invalid or expired'));
        router.replace(`/login?next=${qNext}&reason=${qReason}&msg=${qMsg}`);
        return;
      }

      // Normal magic-link flow
      const access_token  = params.get('access_token');
      const refresh_token = params.get('refresh_token');

      try {
        if (access_token && refresh_token) {
          setMsg('Finalizing session…');
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          // Best-effort: create/ensure profile
          fetch('/api/ensure-profile', { method: 'POST' }).catch(() => {});
          router.replace(next);
          return;
        }

        // Maybe we already have a session?
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.replace(next);
          return;
        }

        // Fallback
        router.replace(`/login?next=${encodeURIComponent(next)}&reason=no_tokens`);
      } catch (e: any) {
        const qMsg = encodeURIComponent(String(e?.message || 'Could not complete sign-in'));
        router.replace(`/login?next=${encodeURIComponent(next)}&reason=set_session_failed&msg=${qMsg}`);
      }
    };

    run();
  }, [router, supabase]);

  return (
    <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0b0b0f',color:'#e5e7eb',fontFamily:'ui-sans-serif'}}>
      <div style={{background:'#0f172a',border:'1px solid #1f2937',borderRadius:16,padding:20,minWidth:280,textAlign:'center'}}>
        {msg}
      </div>
    </div>
  );
}
