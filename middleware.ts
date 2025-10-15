// middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// For now we aren't enforcing auth in middleware (keeps login simple).
// We only scope the middleware to /admin/* so it never runs on /login or review links.
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

// Only run middleware for /admin (managers area left open while testing)
export const config = {
  matcher: ['/admin/:path*'],
};
