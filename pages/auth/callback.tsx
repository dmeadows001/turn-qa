// pages/auth/callback.tsx
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

function parseHash(hash: string) {
  const out: Record<string, string> = {};
  const h = hash?.startsWith('#') ? hash.slice(1) : hash;
  h.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return out;
}

export default function AuthCallback() {
  const router = useRouter();
  const [msg, setMsg] = useState('Completing sign-in…');
  const [fatal, setFatal] = useState<string | null>(null);
  const email = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('email') || ''
    : '';

  const nextPath = useMemo(() => {
    if (typeof window === 'undefined') return '/dashboard';
    return new URLSearchParams(window.location.search).get('next') || '/dashboard';
  }, [router.asPath]);

  async function tryResend() {
    if (!email) return setFatal('Missing email to resend link.');
    try {
      setMsg('Sending a new magic link…');
      const supabase = supabaseBrowser();
      const base = window.location.origin.replace(/\/+$/, '');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(nextPath)}&email=${encodeURIComponent(email)}`
        }
      });
      if (error) throw error;
      setMsg('Check your email for a fresh link.');
    } catch (e: any) {
      setFatal(e?.message || 'Could not resend link.');
    }
  }

  useEffect(() => {
    (async () => {
      const supabase = supabaseBrowser();

      // If Supabase appended explicit error params (like otp_expired), show a friendly message.
      const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const errCode = qs?.get('error_code') || '';
      const errDesc = qs?.get('error_description') || '';
      if (errCode || errDesc) {
        setFatal(errDesc || errCode || 'Link could not be used.');
        return;
      }

      // 1) Try PKCE code flow
      let ok = false;
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (!error && data?.session) ok = true;
      } catch {
        // keep going, we'll try the hash fallback
      }

      // 2) Fallback hash tokens
      if (!ok) {
        const tokens = parseHash(window.location.hash);
        if (tokens.access_token && tokens.refresh_token) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
          });
          if (!setErr) ok = true;
        }
      }

      if (!ok) {
        setFatal('We could not complete sign-in from this link.');
        return;
      }

      // 3) Ensure profile/trial
      try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}

      // 4) Go to next
      router.replace(nextPath);
    })();
  }, [router, nextPath]);

  return (
    <div style={{minHeight:'100vh',display:'grid',placeItems:'center',color:'#e5e7eb',background:'#0b0b0d'}}>
      <div style={{padding:20,border:'1px solid #1f2937',borderRadius:12,background:'#0f172a',maxWidth:720}}>
        {!fatal ? (
          <div>{msg}</div>
        ) : (
          <div>
            <div style={{ marginBottom: 10 }}>{fatal}</div>
            {email ? (
              <button onClick={tryResend} className="btn" style={{ marginRight: 8 }}>
                Resend magic link to {email}
              </button>
            ) : null}
            <a href="/login" className="btn" style={{ marginTop: 8, display: 'inline-block' }}>
              Back to Sign in
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
