// lib/guards.ts
import type { GetServerSidePropsContext } from 'next';
import { createServerClient } from '@supabase/ssr';
import { serialize } from 'cookie';

/**
 * Create a server-side Supabase client that reads/writes auth cookies.
 * This matches the client we use via `createBrowserClient` and ensures
 * the SSR guard can "see" the logged-in session.
 */
function makeServerSupabase(ctx: GetServerSidePropsContext) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => ctx.req.cookies[name],
        set: (name: string, value: string, options: any) => {
          ctx.res.setHeader('Set-Cookie', serialize(name, value, options));
        },
        remove: (name: string, options: any) => {
          ctx.res.setHeader('Set-Cookie', serialize(name, '', { ...options, maxAge: 0 }));
        },
      },
    }
  );
}

/**
 * Require a logged-in *manager* whose phone is verified.
 * - If no session → redirect to /login?next=<current>
 * - If not a manager (adjust if you use a different role model) → /
 * - If manager row missing or not verified → /onboard/manager/phone?uid=<user_id>
 *
 * IMPORTANT: We do **not** insert rows from a guard (GET). Let onboarding create rows.
 */
export async function requireManagerPhoneVerified(ctx: GetServerSidePropsContext) {
  const supabase = makeServerSupabase(ctx);

  // 1) Read the session from auth cookies (set by the browser client)
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    const next = encodeURIComponent(ctx.resolvedUrl || '/dashboard');
    return { redirect: { destination: `/login?next=${next}`, permanent: false } };
  }

  // Optional: app-metadata role check (comment out if you don't use roles there)
  const role = (session.user.app_metadata as any)?.role;
  if (role && role !== 'manager') {
    return { redirect: { destination: '/', permanent: false } };
  }

  // 2) Load manager profile via RLS using the *user* session (no service key here)
  //    Adjust table/columns if your schema differs.
  const { data: mgr, error: mgrErr } = await supabase
    .from('managers')
    .select('phone, sms_consent, phone_verified_at')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (mgrErr) {
    // Fail closed but visible: send to onboarding to resolve state
    return { redirect: { destination: `/onboard/manager/phone?uid=${session.user.id}`, permanent: false } };
  }

  // If there is no row, or not verified, send to onboarding
  const verified = !!(mgr?.phone && mgr?.sms_consent && mgr?.phone_verified_at);
  if (!mgr || !verified) {
    return { redirect: { destination: `/onboard/manager/phone?uid=${session.user.id}`, permanent: false } };
  }

  // 3) Gate passed
  return { ok: true as const, user: session.user };
}
