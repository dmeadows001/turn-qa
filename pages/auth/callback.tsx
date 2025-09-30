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

  const debug = useMemo(() => {
    const qs = typeof window !== 'undefined' ? window.location.search : '';
    const hs = typeof window !== 'undefined' ? window.location.hash : '';
    return { search: qs, hash: hs };
  }, [router.asPath]);

  useEffect(() => {
    (async () => {
      const supabase = supabaseBrowser();

      // Try PKCE (code param)
      let ok = false;
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (!error && data?.session) ok = true;
      } catch {}

      // Fallback: hash tokens
      if (!ok) {
        const tokens = parseHash(window.location.hash);
        if (tokens.access_token && tokens.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
          });
          if (!error) ok = true;
        }
      }

      if (!ok) {
        setMsg('We could not complete sign-in from this link. Please request a new email.');
        return;
      }

      try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}

      const next = new URLSearchParams(window.location.search).get('next') || '/dashboard';
      router.replace(next);
    })();
  }, [router]);

  // show debug if you append ?debug=1
  const showDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';

  return (
    <div style={{minHeight:'100vh',display:'grid',placeItems:'center',color:'#e5e7eb',background:'#0b0b0d'}}>
      <div style={{padding:20,border:'1px solid #1f2937',borderRadius:12,background:'#0f172a',maxWidth:700}}>
        <div>{msg}</div>
        {showDebug && (
          <pre style={{marginTop:12,whiteSpace:'pre-wrap'}}>
{JSON.stringify({ href: typeof window!=='undefined'?window.location.href:null, ...debug }, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
