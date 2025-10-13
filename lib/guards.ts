// lib/guards.ts
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';
import type { GetServerSidePropsContext } from 'next';

export async function requireManagerPhoneVerified(ctx: GetServerSidePropsContext) {
  const supabase = createServerSupabaseClient(ctx);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  // Ensure a managers row exists for this user (create one if missing)
  // This prevents “missing row” from bypassing the gate.
  const { data: mgrRow } = await supabase
    .from('managers')
    .select('id, phone, sms_consent, phone_verified_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!mgrRow) {
    // Create a skeleton manager row for this user so onboarding can complete
    await supabase.from('managers').insert({ user_id: user.id }).select().single();
  }

  // Re-fetch after possible insert
  const { data: mgr } = await supabase
    .from('managers')
    .select('phone, sms_consent, phone_verified_at')
    .eq('user_id', user.id)
    .single();

  const verified = !!(mgr?.phone && mgr?.sms_consent && mgr?.phone_verified_at);
  if (!verified) {
    // pass uid in query so onboarding can hydrate immediately
    return { redirect: { destination: `/onboard/manager/phone?uid=${user.id}`, permanent: false } };
  }

  return { ok: true as const, user };
}
