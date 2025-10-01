// pages/auth/callback.tsx
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function AuthCallback() {
  const router = useRouter();
  const [msg, setMsg] = useState('Completing sign-in…');
  const supabase = useMemo(() => supabaseBrowser(), []);

  useEffect(() => {
    (async () => {
      try {
        // 1) Parse tokens in the URL hash (magic link / OTP) if present.
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        const params = new URLSearchParams(hash.replace(/^#/, ''));
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');

        if (access_token && refresh_token) {
          setMsg('Setting session…');
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
        } else if (router.query.code) {
          // 2) No hash tokens? Try PKCE exchange with ?code=… (email confirm flow)
          setMsg('Verifying code…');
          const { error } = await supabase.auth.exchangeCodeForSession(String(router.query.code));
          if (error) throw error;
        } else if (router.query.error || router.query.error_description) {
          // 3) Surface Supabase error if present
          const err = `${router.query.error}: ${router.query.error_description}`;
          throw new Error(err);
        } else {
          // Nothing to do → send to sign-in
          throw new Error('No tokens found. Please sign in again.');
        }

        // 4) Ensure a profile/trial row exists (safe to ignore failures)
        try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}

        // 5) Go to next (or dashboard)
        const next = (router.query.next as string) || '/dashboard';
        router.replace(next);
      } catch (e: any) {
        console.error('[auth/callback]', e);
        setMsg(e?.message || 'Could not complete sign-in. Please try again.');
      }
    })();
  }, [router, supabase]);

  return (
    <div style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      background: '#0b0b0f', color: '#e5e7eb', fontFamily: 'ui-sans-serif'
    }}>
      <div style={{
        background: '#0f172a', border: '1px solid #1f2937',
        borderRadius: 14, padding: 20, minWidth: 320, textAlign: 'center'
      }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>TurnQA</div>
        <div>{msg}</div>
        {msg?.toLowerCase().includes('could not') && (
          <div style={{ marginTop: 12 }}>
            <a href="/login" style={{ textDecoration: 'underline', color: '#93c5fd' }}>
              Back to Sign in
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
