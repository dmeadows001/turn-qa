// pages/dashboard.tsx
import type { GetServerSideProps } from 'next';
import { requireManagerPhoneVerified } from '@/lib/guards';

type Props = {}; // add fields if you want to pass data to the page

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await requireManagerPhoneVerified(ctx);

  // If the guard indicates a redirect, adapt it to Next's shape
  if ('redirect' in gate) {
    return { redirect: gate.redirect };
  }

  // Otherwise just render the page
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
