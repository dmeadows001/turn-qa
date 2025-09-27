// lib/session.js
import crypto from 'crypto';

const COOKIE_NAME = 'tqa_cl_sess';
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlJSON(obj) { return b64url(JSON.stringify(obj)); }

function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const head = b64urlJSON(header);
  const body = b64urlJSON(payload);
  const toSign = `${head}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(toSign).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return `${toSign}.${sig}`;
}

function verifyJWT(token, secret) {
  if (!token || token.split('.').length !== 3) throw new Error('bad token');
  const [head, body, sig] = token.split('.');
  const toSign = `${head}.${body}`;
  const expect = crypto.createHmac('sha256', secret).update(toSign).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if (crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig)) === false) {
    throw new Error('bad signature');
  }
  const payload = JSON.parse(Buffer.from(body.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
  if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('expired');
  return payload;
}

function serializeCookie(name, value, { maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS, secure = true, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${value}`];
  if (maxAgeSeconds) {
    parts.push(`Max-Age=${maxAgeSeconds}`);
    const exp = new Date(Date.now() + maxAgeSeconds * 1000);
    parts.push(`Expires=${exp.toUTCString()}`);
  }
  parts.push(`Path=${path}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  return parts.join('; ');
}

export function makeCleanerSession({ cleaner_id, phone }, { maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS } = {}) {
  const secret = process.env.TURNQA_SESSION_SECRET || '';
  if (!secret) throw new Error('TURNQA_SESSION_SECRET is not set');
  const now = Math.floor(Date.now()/1000);
  const payload = { sub: String(cleaner_id), phone: String(phone), role: 'cleaner', iat: now, exp: now + maxAgeSeconds };
  const token = signJWT(payload, secret);
  const cookie = serializeCookie(COOKIE_NAME, token, { maxAgeSeconds });
  return { cookie, token, payload };
}

export function readCleanerSession(req) {
  const secret = process.env.TURNQA_SESSION_SECRET || '';
  if (!secret) throw new Error('TURNQA_SESSION_SECRET is not set');
  const raw = req.headers?.cookie || '';
  const m = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!m) return null;
  try {
    const payload = verifyJWT(m[1], secret);
    if (payload?.role !== 'cleaner') return null;
    return payload; // { sub: cleaner_id, phone, ... }
  } catch {
    return null;
  }
}

export function clearCleanerCookie() {
  // Expire immediately
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}
