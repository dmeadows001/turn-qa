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
      const next = (router.query.next as string) || '/dashboard';

      // Read URL hash
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash);

      // If GoTrue sent an error (e.g., otp_expired), route back to login with context
      const err = params.get('error');
      const errCode = params.get('error_code');
      const errDesc = params.get('error_description');
      if (err || errCode) {
        router.replace(`/login?next=${encodeURIComponent(next)}&reason=${encodeURIComponent(errCode || err)}&msg=${encodeURIComponent(errDesc || 'Link invalid or expired')}`);
        return;
      }

      // Normal magic-link flow: tokens in the hash
      const access_token  = params.get('access_token');
      const refresh_token = params.get('refresh_token');

      try {
        if (access_token && refresh_token) {
          setMsg('Finalizing session…');
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          // Non-blocking: ensure profile/trial row
          fetch('/api/ensure-profile', { method: 'POST' }).catch(() => {});
          router.replace(next);
          return;
        }

        // No tokens: maybe session already exists?
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.replace(next);
          return;
        }

        // Fallback: go to login
        router.replace(`/login?next=${encodeURIComponent(next)}&reason=no_tokens`);
      } catch (e: any) {
        router.replace(`/login?next=${encodeURIComponent(next)}&reason=set_session_failed&msg=${encodeURIComponent(e?.message || 'Could not complete sign-in')}`);
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
