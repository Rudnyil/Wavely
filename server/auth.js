import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { forbidden, unauthorized, ApiError } from './errors.js';
import { newId, sha256, now } from './util.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const KEYLEN = 64;
export const COOKIE_NAME = 'wavely_session';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(key, expected);
}

// Verified against when the username does not exist, so timing does not reveal valid names.
let dummyHash;
export async function verifyDummy(password) {
  dummyHash ??= await hashPassword('wavely-dummy-password');
  await verifyPassword(password, dummyHash);
}

export function validateUsername(username) {
  return /^[A-Za-z0-9_]{3,24}$/.test(username);
}

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 200;
}

export function createSession(db, config, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), userId, t, t + config.sessionDays * 86400000);
  return token;
}

export function setSessionCookie(reply, config, token) {
  reply.setCookie(COOKIE_NAME, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure,
    maxAge: config.sessionDays * 86400,
  });
}

export function clearSessionCookie(reply, config) {
  reply.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
}

export function lookupUser(db, token) {
  if (!token || typeof token !== 'string') return null;
  const row = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, u.bio, u.disabled, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`,
  ).get(sha256(token), now());
  if (!row || row.disabled) return null;
  return row;
}

export const isModerator = (user) => !!user && (user.role === 'moderator' || user.role === 'admin');
export const isAdmin = (user) => !!user && user.role === 'admin';

export function requireUser(req) {
  if (!req.user) throw unauthorized();
  return req.user;
}
export function requireModerator(req) {
  const u = requireUser(req);
  if (!isModerator(u)) throw forbidden();
  return u;
}
export function requireAdmin(req) {
  const u = requireUser(req);
  if (!isAdmin(u)) throw forbidden();
  return u;
}

/**
 * CSRF defence for cookie auth: every state-changing API request must carry a custom header
 * (browsers cannot add it cross-site without a CORS preflight, which we never allow) and,
 * when an Origin header is present, it must match the Host.
 */
export function csrfHook(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (!req.url.startsWith('/api/')) return;
  if (req.headers['x-requested-with'] !== 'wavely') {
    throw new ApiError(403, 'csrf', 'Missing X-Requested-With header');
  }
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let host;
    try { host = new URL(origin).host; } catch { host = ''; }
    if (host !== req.headers.host) throw new ApiError(403, 'csrf', 'Cross-origin request blocked');
  } else if (origin === 'null') {
    throw new ApiError(403, 'csrf', 'Cross-origin request blocked');
  }
}

/** In-memory tracker of failed logins per username, to slow down password guessing. */
export class LoginThrottle {
  constructor({ max = 8, windowMs = 15 * 60 * 1000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.map = new Map();
  }

  key(name) { return String(name).toLowerCase(); }

  blocked(name) {
    const e = this.map.get(this.key(name));
    if (!e) return false;
    if (now() - e.first > this.windowMs) { this.map.delete(this.key(name)); return false; }
    return e.count >= this.max;
  }

  fail(name) {
    const k = this.key(name);
    const e = this.map.get(k);
    if (!e || now() - e.first > this.windowMs) this.map.set(k, { count: 1, first: now() });
    else e.count += 1;
    if (this.map.size > 10000) this.map.clear();
  }

  reset(name) { this.map.delete(this.key(name)); }
}

export function purgeExpired(db) {
  const t = now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(t);
  db.prepare('DELETE FROM plays_recent WHERE at < ?').run(t - 31 * 60 * 1000);
}

export { newId };
