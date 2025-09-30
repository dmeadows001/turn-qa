// pages/auth/callback.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function AuthCallback() {
  const router = useRouter();
  const [msg, setMsg] = useState('Completing sign-in…');

  useEffect(() => {
    const run = async () => {
      const supabase = supabaseBrowser();

      // 1) Exchange the code (for magic links / email confirm)
      const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
      if (error) {
        setMsg(error.message || 'Could not complete sign-in.');
        return;
      }

      // 2) Ensure a profile + 30-day trial exists
      try {
        await fetch('/api/ensure-profile', { method: 'POST' });
      } catch {}

      // 3) Redirect to next=/… or /dashboard
      const next = new URLSearchParams(window.location.search).get('next') || '/dashboard';
      router.replace(next);
    };

    run();
  }, [router]);

  return (
    <div style={{minHeight:'100vh',display:'grid',placeItems:'center',color:'#e5e7eb',background:'#0b0b0d'}}>
      <div style={{padding:20,border:'1px solid #1f2937',borderRadius:12,background:'#0f172a'}}>
        {msg}
      </div>
    </div>
  );
}
