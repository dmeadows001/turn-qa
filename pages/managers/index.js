// pages/managers/index.js
import Link from 'next/link';
import { requireManagerPhoneVerified } from '@/lib/guards';

export async function getServerSideProps(ctx) {
  const gate = await requireManagerPhoneVerified(ctx);
  if (gate?.redirect) return { redirect: gate.redirect };
  return { props: {} };
}

export default function ManagersHome() {
  return (
    <main className="p-6" style={{ color: 'var(--text, #fff)' }}>
      <h1 className="text-2xl font-bold mb-4">Manager Home</h1>
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <NavCard title="Properties" href="/admin/properties" desc="Create or edit properties" />
        <NavCard title="Invite Cleaner" href="/properties/PLACE_ID/invite" desc="Send SMS invite (replace PLACE_ID)" />
        <NavCard title="Start a Turn" href="/properties/PLACE_ID/start-turn" desc="Manual start (replace PLACE_ID)" />
        <NavCard title="Review a Turn" href="/turns/PLACE_TURN_ID/review" desc="Open review by ID" />
      </section>
    </main>
  );
}

function NavCard({ title, href, desc }) {
  return (
    <Link href={href} className="block rounded-2xl p-4 border border-white/10 hover:border-white/20 transition">
      <div className="text-lg font-semibold">{title}</div>
      <div className="opacity-80 text-sm mt-1">{desc}</div>
      <div className="underline text-sm mt-3">Open →</div>
    </Link>
  );
}
