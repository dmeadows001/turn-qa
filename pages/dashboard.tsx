import type { GetServerSideProps } from 'next';
import { requireManagerPhoneVerified } from '@/lib/guards';

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const gate: any = await requireManagerPhoneVerified(ctx as any);
  if (gate?.redirect) return { redirect: gate.redirect };
  return { redirect: { destination: '/admin/properties', permanent: false } };
};
export default function DashboardRedirect(){ return null; }
