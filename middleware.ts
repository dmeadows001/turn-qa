// middleware.ts
import { NextResponse, NextRequest } from 'next/server';

export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)).*)'],
};
