// middleware.ts
import { NextResponse, NextRequest } from 'next/server';
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/auth',               // ✅ allow callback & any /auth/* pages
  '/api/ensure-profile', // ✅ allow post-auth profile creation
  '/api/health',
  '/api/debug-sms-config',
  '/billing',
  '/legal',
  '/support',
  '/api/stripe/webhook',
  '/api/billing'
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes pass through (match exact or any child path)
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  // Require an active session
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Optional: gate paid/active status here (unchanged from your prior logic)
  // If you keep the trial checks, ensure profiles exist first (ensure-profile).

  return res;
}

export const config = {
  matcher: [
    // protect everything except _next assets, static files, etc.
    '/((?!_next|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)).*)',
  ],
};
