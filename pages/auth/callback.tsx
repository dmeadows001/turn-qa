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

  const url = typeof window !== 'undefined' ? window.location.href : '';
  const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const nextPath = useMemo(() => (qs?.get('next') || '/dashboard'), [qs]);
  const email = useMemo(() => (qs?.get('email') || ''), [qs]);

  async function tryResend() {
    try {
      if (!email) throw new Error('Missing email to resend link.');
      setMsg('Sending a new magic link…');
      const supabase = supabaseBrowser();
      const base = window.location.origin.replace(/\/+$/, '');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(
            nextPath
          )}&email=${encodeURIComponent(email)}`
        }
      });
      if (error) throw error;
      setFatal(null);
      setMsg('Check your email for a fresh link.');
    } catch (e: any) {
      console.error('[callback] resend failed:', e);
      setFatal(e?.message || 'Could not resend link.');
    }
  }

  useEffect(() => {
    (async () => {
      try {
        console.log('[callback] URL:', url);
        const supabase = supabaseBrowser();

        // A) explicit error params
        const errCode = qs?.get('error_code');
        const errDesc = qs?.get('error_description');
        if (errCode || errDesc) {
          console.error('[callback] explicit error:', errCode, errDesc);
          setFatal(errDesc || errCode || 'Link could not be used.');
          return;
        }

        // B) PKCE (?code=...)
        const code = qs?.get('code');
        if (code) {
          console.log('[callback] found PKCE code');
          const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
          console.log('[callback] PKCE exchange success:', !!data?.session);
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
          window.location.replace(nextPath);
          return;
        }

        // C) Email verify/magic/recovery (?token_hash & type)
        const tokenHash = qs?.get('token_hash') || qs?.get('token');
        const type = (qs?.get('type') || '').toLowerCase();
        if (tokenHash && type) {
          console.log('[callback] found token_hash + type:', type);
          const { data, error } = await supabase.auth.verifyOtp({ type: type as any, token_hash: tokenHash });
          if (error) throw error;
          console.log('[callback] verifyOtp success:', !!data?.session);
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
          window.location.replace(nextPath);
          return;
        }

        // D) Hash tokens (#access_token & refresh_token)
        const tokens = parseHash(typeof window !== 'undefined' ? window.location.hash : '');
        console.log('[callback] hash tokens:', Object.keys(tokens));
        if (tokens.access_token && tokens.refresh_token) {
          console.log('[callback] calling setSession()');
          const { error } = await supabase.auth.setSession({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token
          });
          if (error) throw error;
          console.log('[callback] setSession success, ensuring profile…');
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
          console.log('[callback] redirect →', nextPath);
          window.location.replace(nextPath);
          return;
        }

        // Nothing usable
        console.warn('[callback] no tokens/codes found');
        setFatal('We could not complete sign-in from this link.');
      } catch (e: any) {
        console.error('[callback] fatal error:', e);
        setFatal(e?.message || 'Something went wrong completing sign-in.');
      }
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
