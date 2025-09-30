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

function withTimeout<T>(p: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`setSession timeout after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }).catch(e => { clearTimeout(t); reject(e); });
  });
}

export default function AuthCallback() {
  const [msg, setMsg] = useState('Completing sign-in…');
  const [fatal, setFatal] = useState<string | null>(null);

  const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const nextPath = useMemo(() => qs?.get('next') || '/dashboard', [qs]);
  const email = useMemo(() => qs?.get('email') || '', [qs]);

  async function resend() {
    try {
      const supabase = supabaseBrowser();
      const base = window.location.origin.replace(/\/+$/, '');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(nextPath)}&email=${encodeURIComponent(email)}` }
      });
      if (error) throw error;
      setMsg('Sent a fresh link. Check your inbox.');
      setFatal(null);
    } catch (e: any) {
      console.error('[callback] resend error:', e);
      setFatal(e?.message || 'Could not resend link.');
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const url = typeof window !== 'undefined' ? window.location.href : '';
        console.log('[callback] URL:', url);

        const supabase = supabaseBrowser();

        // explicit error from provider
        const errCode = qs?.get('error_code');
        const errDesc = qs?.get('error_description');
        if (errCode || errDesc) {
          console.error('[callback] explicit error:', errCode, errDesc);
          setFatal(errDesc || errCode || 'Link error.');
          return;
        }

        // PKCE ?code=
        const code = qs?.get('code');
        if (code) {
          console.log('[callback] found PKCE code → exchange');
          const { data, error } = await supabase.auth.exchangeCodeForSession(url);
          console.log('[callback] exchange result:', { hasSession: !!data?.session, error });
          if (error) throw error;
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
          window.location.replace(nextPath);
          return;
        }

        // token_hash & type
        const tokenHash = qs?.get('token_hash') || qs?.get('token');
        const type = (qs?.get('type') || '').toLowerCase();
        if (tokenHash && type) {
          console.log('[callback] found token_hash + type:', type);
          const { data, error } = await supabase.auth.verifyOtp({ type: type as any, token_hash: tokenHash });
          console.log('[callback] verifyOtp result:', { hasSession: !!data?.session, error });
          if (error) throw error;
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}
          window.location.replace(nextPath);
          return;
        }

        // hash tokens (#access_token / #refresh_token) — your case
        const tokens = parseHash(typeof window !== 'undefined' ? window.location.hash : '');
        console.log('[callback] hash tokens:', Object.keys(tokens));
        if (tokens.access_token && tokens.refresh_token) {
          console.log('[callback] calling setSession()');
          try {
            const result = await withTimeout(
              supabase.auth.setSession({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token
              }),
              4000 // 4s guard to avoid hanging
            );
            console.log('[callback] setSession result:', result);
          } catch (e: any) {
            console.error('[callback] setSession error/timeout:', e);
            // Not fatal to UX → proceed to dashboard; client should still have hash
          }

          // Best-effort profile init; don't block redirect
          try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch (e) {
            console.warn('[callback] ensure-profile failed (non-fatal):', e);
          }

          console.log('[callback] redirect →', nextPath);
          window.location.replace(nextPath);
          return;
        }

        console.warn('[callback] no usable tokens found.');
        setFatal('We could not complete sign-in from this link.');
      } catch (e: any) {
        console.error('[callback] fatal:', e);
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
              <button onClick={resend} className="btn" style={{ marginRight: 8 }}>
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
