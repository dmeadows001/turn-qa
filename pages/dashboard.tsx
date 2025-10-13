// pages/dashboard.tsx
import type { GetServerSideProps } from 'next';
import { requireManagerPhoneVerified } from '@/lib/guards';

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const gate = await requireManagerPhoneVerified(ctx);
  if ('redirect' in gate) return gate; // bounce to phone onboarding if not verified
  return { props: {} };
};

export default function Dashboard() {
  // ...your existing dashboard UI here. Keeping a minimal placeholder:
  return (
    <main style={{ padding: 24 }}>
      <h1>Dashboard</h1>
      <p>Manager is verified ✅</p>
    </main>
  );
}
