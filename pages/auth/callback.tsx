// pages/auth/callback.tsx
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

function parseHash(hash: string) {
  const out: Record<string, string> = {};
  const h = hash?.startsWith('#') ? hash.slice(1) : hash;
  if (!h) return out;
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

  const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const nextPath = useMemo(() => (qs?.get('next') || '/dashboard'), [qs]);
  const email = useMemo(() => (qs?.get('email') || ''), [qs]);

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
      setFatal(null);
      setMsg('Check your email for a fresh link.');
    } catch (e: any) {
      setFatal(e?.message || 'Could not resend link.');
    }
  }

  useEffect(() => {
    (async () => {
      const supabase = supabaseBrowser();

      // A) Explicit Supabase error in query (e.g., otp_expired)
      const errCode = qs?.get('error_code');
      const errDesc = qs?.get('error_description');
      if (errCode || errDesc) {
        setFatal(errDesc || errCode || 'Link could not be used.');
        return;
      }

      // B) PKCE code flow (?code=...)
      const code = qs?.get('code');
      if (code) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
          // ensure profile/trial
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
          router.replace(nextPath);
          return;
        } catch (e: any) {
          // fall through to other methods
        }
      }

      // C) Email confirm / recovery / change / magiclink (?token_hash=...&type=...)
      const tokenHash = qs?.get('token_hash') || qs?.get('token');
      const type = (qs?.get('type') || '').toLowerCase();
      // Valid types per supabase-js: 'signup' | 'magiclink' | 'recovery' | 'email_change'
      if (tokenHash && type) {
        try {
          const { data, error } = await supabase.auth.verifyOtp({
            type: type as any,
            token_hash: tokenHash
          });
          if (error) throw error;
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
          router.replace(nextPath);
          return;
        } catch (e: any) {
          // continue to hash fallback
        }
      }

      // D) Hash tokens (#access_token=...&refresh_token=...)
      const tokens = parseHash(typeof window !== 'undefined' ? window.location.hash : '');
      if (tokens.access_token && tokens.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        });
        if (!error) {
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
          router.replace(nextPath);
          return;
        }
      }

      // If we got here, nothing usable was present
      setFatal('We could not complete sign-in from this link.');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
