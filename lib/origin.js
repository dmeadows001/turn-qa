// lib/origin.js
export function getOrigin(req) {
  // Prefer an explicit env var if you set one
  const env =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL; // optional (Vercel projects)

  if (env) return env.replace(/\/+$/, ''); // strip trailing slash

  // Fallback: infer from request headers (works on Vercel)
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host  = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0];
  return `${proto}://${host}`;
}

export function absUrl(req, path = '/') {
  const base = getOrigin(req);
  if (!path.startsWith('/')) path = '/' + path;
  return base + path;
}
