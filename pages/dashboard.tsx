import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

type TurnRow = {
  id: string;
  property_name?: string | null;
  status?: string | null;     // 'pending' | 'needs_fix' | 'approved' | etc.
  submitted_at?: string | null;
};

export default function Dashboard() {
  const router = useRouter();
  const sb = supabaseBrowser();

  // === your original guard, unchanged ===
  const [checked, setChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let timeoutId: any;

    sb.auth.getSession().then(({ data }) => {
      if (data.session) {
        setUserId(data.session.user.id);
        setChecked(true);
      } else {
        timeoutId = setTimeout(async () => {
          const { data: again } = await sb.auth.getSession();
          if (again?.session) {
            setUserId(again.session.user.id);
            setChecked(true);
          } else {
            router.replace('/login?next=/dashboard');
          }
        }, 600);
      }
    });

    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (session) {
        setUserId(session.user.id);
        setChecked(true);
      }
    });

    return () => {
      clearTimeout(timeoutId);
      sub.subscription?.unsubscribe();
    };
  }, [router, sb]);

  if (!checked) return <main className="p-6">Loading…</main>;

  // === manager overview ===
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        // Adjust table/columns if yours differ. This assumes a view filtered by RLS.
        const q = sb
          .from('turns_view')
          .select('id, property_name, status, submitted_at')
          .order('submitted_at', { ascending: false })
          .limit(50);

        // If your RLS requires explicit manager_id equality and the view exposes it:
        // .eq('manager_id', userId!)

        const { data, error } = await q;
        if (error) throw error;
        if (!mounted) return;
        setTurns((data ?? []) as TurnRow[]);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message ?? 'Failed to load turns');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [sb, userId]);

  async function handleSignOut() {
    await sb.auth.signOut();
    router.replace('/login');
  }

  const statusBadge = (s?: string | null) => {
    const label = (s ?? 'unknown').replace('_', ' ');
    const base =
      'px-2 py-1 rounded text-xs border';
    const cls =
      s === 'approved' ? `${base} border-emerald-500/30`
      : s === 'needs_fix' ? `${base} border-amber-500/30`
      : s === 'pending' ? `${base} border-sky-500/30`
      : `${base} border-white/15`;
    return <span className={cls}>{label}</span>;
  };

  return (
    <main className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <button
          onClick={handleSignOut}
          className="px-3 py-2 rounded-lg border border-white/10 hover:border-white/20"
        >
          Sign out
        </button>
      </div>

      {err && (
        <div className="mb-4 text-sm text-rose-300">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm opacity-80">Loading your latest turns…</div>
      ) : turns.length === 0 ? (
        <div className="text-sm opacity-80">
          No turns yet. When a cleaner submits, they’ll appear here.
        </div>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {turns.map(t => (
            <a
              key={t.id}
              href={`/review/${t.id}`}
              className="block rounded-2xl p-4 border border-white/10 hover:border-white/20 transition"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">
                  {t.property_name || 'Property'}
                </h3>
                {statusBadge(t.status)}
              </div>
              <div className="mt-2 text-xs opacity-80">
                Submitted: {t.submitted_at ? new Date(t.submitted_at).toLocaleString() : '—'}
              </div>
              <div className="mt-3 text-sm underline">Open review →</div>
            </a>
          ))}
        </section>
      )}
    </main>
  );
}
