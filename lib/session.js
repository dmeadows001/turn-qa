// lib/session.js
import crypto from 'crypto';

const COOKIE_NAME = 'tqa_cl_sess';
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ----------------- helpers -----------------
function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function b64urlJSON(obj) {
  return b64url(JSON.stringify(obj));
}

function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const head = b64urlJSON(header);
  const body = b64urlJSON(payload);
  const toSign = `${head}.${body}`;
  const sig = crypto
    .createHmac('sha256', secret)
    .update(toSign)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${toSign}.${sig}`;
}

function verifyJWT(token, secret) {
  if (!token || token.split('.').length !== 3) throw new Error('bad token');
  const [head, body, sig] = token.split('.');
  const toSign = `${head}.${body}`;
  const expect = crypto
    .createHmac('sha256', secret)
    .update(toSign)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (!crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) {
    throw new Error('bad signature');
  }
  const payload = JSON.parse(
    Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  );
  if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('expired');
  return payload;
}

// Figure out a proper cookie Domain based on the request host
function domainForReq(req) {
  try {
    const host = String(req?.headers?.host || '').toLowerCase();
    // local dev or unknown host: omit Domain so it only applies to the current host:port
    if (!host || host.includes('localhost') || host.startsWith('127.')) return null;
    // production: scope to the registrable suffix so it works on www + apex
    if (host.endsWith('turnqa.com')) return '.turnqa.com';
    return null;
  } catch {
    return null;
  }
}

function serializeCookie(
  name,
  value,
  {
    maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
    secure = true,
    httpOnly = true,
    sameSite = 'Lax',
    path = '/',
    domain = null,
  } = {}
) {
  const parts = [`${name}=${value}`];
  if (maxAgeSeconds != null) {
    parts.push(`Max-Age=${maxAgeSeconds}`);
    const exp = new Date(Date.now() + Math.max(0, maxAgeSeconds) * 1000);
    parts.push(`Expires=${exp.toUTCString()}`);
  }
  if (domain) parts.push(`Domain=${domain}`);
  parts.push(`Path=${path}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  return parts.join('; ');
}

// ----------------- public API -----------------

/**
 * Create the cleaner session cookie.
 * Call as: const { cookie } = makeCleanerSession({ cleaner_id, phone }, req)
 * (req is optional in dev, but recommended so we can add Domain in prod.)
 */
export function makeCleanerSession(
  { cleaner_id, phone },
  req,
  { maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS } = {}
) {
  const secret = process.env.TURNQA_SESSION_SECRET || '';
  if (!secret) throw new Error('TURNQA_SESSION_SECRET is not set');

  const now = Math.floor(Date.now() / 1000);
  const sub = String(cleaner_id);
  const payload = {
    sub, // canonical id
    cleaner_id: sub, // keep a duplicate field to simplify readers
    phone: String(phone || ''),
    role: 'cleaner',
    iat: now,
    exp: now + maxAgeSeconds,
  };

  const token = signJWT(payload, secret);
  const cookie = serializeCookie(COOKIE_NAME, token, {
    maxAgeSeconds,
    // Domain is added on prod so cookie works on both apex + www
    domain: domainForReq(req),
    // path=/, httponly, secure, samesite=lax are set inside serializeCookie
  });

  return { cookie, token, payload };
}

/** Read + verify cookie, return normalized object with .cleaner_id, .sub, .id */
export function readCleanerSession(req) {
  const secret = process.env.TURNQA_SESSION_SECRET || '';
  if (!secret) throw new Error('TURNQA_SESSION_SECRET is not set');

  const raw = req?.headers?.cookie || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!m) return null;

  try {
    const payload = verifyJWT(m[1], secret);
    if (payload?.role !== 'cleaner') return null;

    // Normalize id fields so any API can pick a consistent key
    const cleaner_id = payload.cleaner_id || payload.sub || payload.id || null;
    if (!cleaner_id) return null;

    return {
      ...payload,
      cleaner_id,
      sub: cleaner_id,
      id: cleaner_id,
    };
  } catch {
    return null;
  }
}

// Some routes import this name:
export const parseCleanerSession = readCleanerSession;

/** Expire cookie immediately (for sign-out) */
export function clearCleanerCookie(req) {
  return serializeCookie(COOKIE_NAME, '', {
    maxAgeSeconds: 0,
    domain: domainForReq(req),
  });
}
