// pages/dashboard.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

type TurnRow = {
  id: string;
  property_name?: string | null;
  status?: string | null;
  submitted_at?: string | null;
};

const safeDate = (iso?: string | null) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  try { return new Date(t).toLocaleString(); } catch { return '—'; }
};

export default function Dashboard() {
  const router = useRouter();
  const sb = supabaseBrowser();

  // Auth guard (your pattern)
  const [checked, setChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let timeoutId: any;

    sb.auth.getSession().then(({ data, error }) => {
      console.log('[dash] getSession error?', !!error, 'hasSession?', !!data?.session);
      if (data?.session) {
        setUserId(data.session.user.id);
        setChecked(true);
      } else {
        timeoutId = setTimeout(async () => {
          const { data: again } = await sb.auth.getSession();
          console.log('[dash] recheck hasSession?', !!again?.session);
          if (again?.session) {
            setUserId(again.session.user.id);
            setChecked(true);
          } else {
            console.log('[dash] redirecting to login');
            router.replace('/login?next=/dashboard');
          }
        }, 600);
      }
    });

    const { data: sub } = sb.auth.onAuthStateChange((e, session) => {
      console.log('[dash] onAuthStateChange', e, 'hasSession?', !!session);
      if (session) {
        setUserId(session.user.id);
        setChecked(true);
      }
    });

    return () => {
      clearTimeout(timeoutId);
      sub.subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!checked) {
    return (
      <main className="p-6" style={{ color: 'var(--text, #fff)' }}>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p>Loading auth…</p>
      </main>
    );
  }

  // Data load
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        console.log('[dash] fetching turns_view…');
        const { data, error } = await sb
          .from('turns_view')
          .select('id, property_name, status, submitted_at')
          .order('submitted_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        if (!mounted) return;
        setTurns(Array.isArray(data) ? (data as TurnRow[]) : []);
        console.log('[dash] turns loaded:', Array.isArray(data) ? data.length : 0);
      } catch (e: any) {
        console.error('[dash] fetch error:', e);
        if (!mounted) return;
        setErr(e?.message ?? 'Failed to load turns');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [sb, userId]);

  return (
    <main className="p-6" style={{ color: 'var(--text, #fff)' }}>
      <h1 className="text-2xl font-bold mb-3">Dashboard</h1>

      <div style={{ padding: 12, border: '1px solid rgba(255,255,255,.15)', borderRadius: 12, marginBottom: 12 }}>
        <div className="text-sm opacity-80">
          <div><strong>checked:</strong> {String(checked)}</div>
          <div><strong>userId:</strong> {userId || '—'}</div>
          <div><strong>loading:</strong> {String(loading)}</div>
        </div>
      </div>

      {err && (
        <div style={{ color: '#fda4af', marginBottom: 12 }}>
          Error: {err}
        </div>
      )}

      {!err && loading && <div className="opacity-80">Loading your latest turns…</div>}

      {!err && !loading && turns.length === 0 && (
        <div className="opacity-80">No turns yet.</div>
      )}

      {!err && !loading && turns.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {turns.map((t) => (
            <a key={t.id} href={`/review/${t.id}`} className="block rounded-2xl p-4 border border-white/10 hover:border-white/20 transition">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">{t.property_name || 'Property'}</h3>
                <span className="text-xs opacity-80">{t.status || 'unknown'}</span>
              </div>
              <div className="mt-2 text-xs opacity-80">{safeDate(t.submitted_at)}</div>
              <div className="mt-3 text-sm underline">Open review →</div>
            </a>
          ))}
        </section>
      )}
    </main>
  );
}
