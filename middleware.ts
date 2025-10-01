// middleware.ts (top of file)
import { NextResponse, NextRequest } from 'next/server';
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';

const CANON_HOST = 'www.turnqa.com';

export async function middleware(req: NextRequest) {
  // 🔒 Force canonical host (prevents cookie loss across hosts)
  const host = req.headers.get('host') || '';
  if (host !== CANON_HOST) {
    const url = req.nextUrl.clone();
    url.host = CANON_HOST;
    url.protocol = 'https';         // ensure https
    return NextResponse.redirect(url, 301);
  }

  // ... keep your existing code below ...
  const PUBLIC_PATHS = [
    '/', '/login', '/signup', '/dashboard', '/auth', '/api/auth', '/api/ensure-profile',
    '/api/health', '/api/debug-sms-config', '/billing',
    '/legal', '/support', '/api/stripe/webhook', '/api/billing'
  ];

  const { pathname } = req.nextUrl;
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

  return res;
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)).*)'],
};
