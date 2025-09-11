// middleware.js
import { NextResponse } from 'next/server';

export function middleware(req) {
  const url = req.nextUrl;

  // Protect /managers and all subpaths, except /managers/login and /api/manager-login
  const isManagersPath = url.pathname.startsWith('/managers');
  const isLogin = url.pathname === '/managers/login' || url.pathname === '/api/manager-login';

  if (!isManagersPath || isLogin) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get('mgr');
  if (cookie?.value === 'ok') {
    return NextResponse.next();
  }

  // redirect to login
  const loginUrl = url.clone();
  loginUrl.pathname = '/managers/login';
  loginUrl.search = ''; // clear query
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/managers/:path*'],
};
