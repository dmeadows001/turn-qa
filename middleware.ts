// middleware.ts
import { NextResponse, NextRequest } from 'next/server';
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/billing',
  '/legal',
  '/support',
  '/api/health',
  '/api/debug-sms-config',
  '/api/stripe/webhook',
  '/api/billing'
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) Public routes pass through
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // 2) Require auth for everything else
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // 3) Cleaner routes are protected but NOT subscription-gated
  if (pathname.startsWith('/cleaner')) {
    return res; // signed-in cleaner can proceed
  }

  // 4) For non-cleaner routes, enforce subscription/trial
  const { data: profile } = await supabase
    .from('profiles')
    .select('active_until, subscription_status')
    .eq('id', session.user.id)
    .maybeSingle();

  const now = new Date();
  const activeUntil = profile?.active_until ? new Date(profile.active_until) : null;

  const isActive =
    profile?.subscription_status === 'active' ||
    (!!activeUntil && activeUntil.getTime() > now.getTime());

  if (!isActive) {
    const url = req.nextUrl.clone();
    url.pathname = '/billing';
    url.searchParams.set('reason', profile ? 'expired' : 'no-profile');
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    // protect everything except Next internals and static assets
    '/((?!_next|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)).*)',
  ],
};
