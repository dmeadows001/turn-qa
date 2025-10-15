// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

// Only protect /admin for now
export const config = { matcher: ['/admin/:path*'] };
