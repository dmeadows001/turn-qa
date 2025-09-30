// pages/auth/callback.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

function parseHash(hash: string) {
  // hash like: "#access_token=...&expires_in=...&refresh_token=...&token_type=bearer&type=signup"
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

  useEffect(() => {
    (async () => {
      const supabase = supabaseBrowser();

      // 1) Try PKCE/code flow first (works when ?code=... is present and the code_verifier exists)
      let exchanged = false;
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (!error && data?.session) {
          exchanged = true;
        }
      } catch {
        // ignore, we'll try hash fallback next
      }

      // 2) Fallback: handle hash tokens (#access_token & #refresh_token)
      if (!exchanged) {
        const tokens = parseHash(window.location.hash);
        if (tokens.access_token && tokens.refresh_token) {
          const { data: setData, error: setErr } = await supabase.auth.setSession({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
          });
          if (setErr) {
            setMsg(setErr.message || 'Could not complete sign-in.');
            return;
          }
        } else {
          // Neither PKCE nor hash tokens available -> show helpful guidance
          setMsg(
            'We could not complete sign-in from this link. Please try opening the link in the same browser you used to sign up, or request a new email.'
          );
          return;
        }
      }

      // 3) Ensure the 30-day trial profile exists
      try { await fetch('/api/ensure-profile', { method: 'POST' }); } catch {}

      // 4) Redirect to next or /dashboard
      const next = new URLSearchParams(window.location.search).get('next') || '/dashboard';
      router.replace(next);
    })();
  }, [router]);

  return (
    <div style={{minHeight:'100vh',display:'grid',placeItems:'center',color:'#e5e7eb',background:'#0b0b0d'}}>
      <div style={{padding:20,border:'1px solid #1f2937',borderRadius:12,background:'#0f172a'}}>
        {msg}
      </div>
    </div>
  );
}
