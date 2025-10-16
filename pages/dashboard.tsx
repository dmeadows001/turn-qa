import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function Dashboard() {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let timeoutId: any;

    sb.auth.getSession().then(({ data }) => {
      if (data.session) {
        setChecked(true);
      } else {
        // small grace period to let localStorage hydrate
        timeoutId = setTimeout(async () => {
          const { data: again } = await sb.auth.getSession();
          if (again?.session) {
            setChecked(true);
          } else {
            router.replace('/login?next=/dashboard');
          }
        }, 600);
      }
    });

    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (session) setChecked(true);
    });

    return () => {
      clearTimeout(timeoutId);
      sub.subscription?.unsubscribe();
    };
  }, [router, sb]);

  if (!checked) return <main className="p-6">Loading…</main>;

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      {/* your real dashboard content here */}
    </main>
  );
}
