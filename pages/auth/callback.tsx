// pages/auth/callback.tsx
import { useEffect, useMemo, useState } from 'react';
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

      // A) explicit error params from Supabase (e.g. otp_expired)
      const errCode = qs?.get('error_code');
      const errDesc = qs?.get('error_description');
      if (errCode || errDesc) {
        setFatal(errDesc || errCode || 'Link could not be used.');
        return;
      }

      // B) PKCE (?code=...)
      const code = qs?.get('code');
      if (code) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
          window.location.replace(nextPath); // hard redirect so middleware sees session
          return;
        } catch (e: any) {
          // try other flows
        }
      }

      // C) email confirm / magiclink / recovery (?token_hash=...&type=...)
      const tokenHash = qs?.get('token_hash') || qs?.get('token');
      const type = (qs?.get('type') || '').toLowerCase();
      if (tokenHash && type) {
        try {
          const { error } = await supabase.auth.verifyOtp({ type: type as any, token_hash: tokenHash });
          if (error) throw error;
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
          window.location.replace(nextPath);
          return;
        } catch (e: any) {
          // try hash fallback next
        }
      }

      // D) hash tokens (#access_token=...&refresh_token=...)
      const tokens = parseHash(typeof window !== 'undefined' ? window.location.hash : '');
      if (tokens.access_token && tokens.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        });
        if (error) {
          setFatal(error.message || 'Could not set session from link.');
          return;
        }
        try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
        window.location.replace(nextPath);
        return;
      }

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
