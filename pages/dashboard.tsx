
// pages/dashboard.tsx
import type { GetServerSideProps } from 'next';
import { requireManagerPhoneVerified } from '@/lib/guards';

type Props = {}; // extend later if you pass data

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  // Treat the guard’s return loosely to avoid union-type mismatch
  const gate: any = await requireManagerPhoneVerified(ctx as any);

  if (gate && gate.redirect) {
    // Return a proper Next.js redirect object
    return { redirect: gate.redirect };
  }

  // Always return props when not redirecting
  return { props: {} };
};

export default function Dashboard() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Dashboard</h1>
      <p>Manager is verified ✅</p>
    </main>
  );
}
