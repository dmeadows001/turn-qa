import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';

export async function getServerSideProps(ctx: any) {
  const supabase = createServerSupabaseClient(ctx);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { redirect: { destination: '/login', permanent: false } };

  const { data: mgr } = await supabase
    .from('managers')
    .select('phone, sms_consent, phone_verified_at')
    .eq('user_id', user.id)
    .single();

  const verified = !!(mgr?.phone && mgr?.sms_consent && mgr?.phone_verified_at);
  if (!verified) {
    return { redirect: { destination: '/onboard/manager/phone', permanent: false } };
  }

  return { props: {} };
}
