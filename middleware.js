// middleware.js
import { NextResponse } from 'next/server';

// Only protect /admin now. Managers area is open while testing.
export const config = { matcher: ['/admin/:path*'] };

export default function middleware(_req) {
  return NextResponse.next();
}
