// pages/dashboard.tsx
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';

type Props = Record<string, never>;

export default function Dashboard(_props: Props) {
  // Your existing dashboard UI goes here
  return <div className="p-6">Dashboard</div>;
}

export async function getServerSideProps(
  ctx: GetServerSidePropsContext
): Promise<GetServerSidePropsResult<Props>> {
  const supabase = createServerSupabaseClient(ctx);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in → go to login
  if (!user) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  // Require verified + consented phone before accessing dashboard
  const { data: mgr, error } = await supabase
    .from('managers')
    .select('phone, sms_consent, phone_verified_at')
    .eq('user_id', user.id)
    .single();

  const verified = !!(mgr?.phone && mgr?.sms_consent && mgr?.phone_verified_at);

  // If there’s no managers row yet or not verified, send to the verify step
  if (error || !verified) {
    return { redirect: { destination: '/onboard/manager/phone', permanent: false } };
  }

  return { props: {} };
}
