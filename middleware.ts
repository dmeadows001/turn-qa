// middleware.ts
import { NextResponse, NextRequest } from 'next/server';
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';

const PUBLIC_PATHS = [
  '/', '/login', '/signup', '/api/health', '/api/debug-sms-config', '/billing', '/legal', '/support', '/api/stripe/webhook', '/api/billing'
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // public routes pass through
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // fetch profile to check active_until
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('active_until, subscription_status')
    .eq('id', session.user.id)
    .single();

  // if no profile or expired, send to billing
  const now = new Date();
  const activeUntil = profile?.active_until ? new Date(profile.active_until) : null;
  const isActive = activeUntil && activeUntil.getTime() > now.getTime();

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
    // protect everything except public paths
    '/((?!_next|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)).*)',
  ],
};
