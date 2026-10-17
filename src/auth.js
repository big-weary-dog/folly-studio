// Accounts and cookie sessions. Passwords: scrypt (N=16384, r=8, p=1), a 16-byte salt each, compared with
// timingSafeEqual. Sessions: 32 random bytes in the `studio_session` cookie for 30 days; the store only sees
// sha256(token), the session's id.

import { scrypt as scryptCb, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
export const COOKIE_NAME = 'studio_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_SESSIONS_PER_USER = 20;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MAX_PASSWORD = 1024;

/** An error that becomes an HTTP response `{ error: message }`. */
export class HttpError extends Error {
  constructor(status, message, headers) {
    super(message);
    Object.assign(this, { status, headers });
  }
}

/** Lower-cased username, or null if it is not 3–32 of [a-z0-9_-]. */
export function normalizeUsername(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().toLowerCase();
  return /^[a-z0-9_-]{3,32}$/.test(n) ? n : null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFC'), salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [kind, N, r, p, saltB64, keyB64] = stored.split('$');
  if (kind !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64url');
  const opts = { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 };
  const key = await scrypt(password.normalize('NFC'), Buffer.from(saltB64, 'base64url'), expected.length, opts)
    .catch(() => null);
  return !!key && key.length === expected.length && timingSafeEqual(key, expected);
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Fixed-window counter: hit(key) → 0 when allowed, else seconds until the window resets. */
export function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    hit(key, now = Date.now()) {
      let e = hits.get(key);
      if (!e || e.reset <= now) {
        if (hits.size > 10_000) for (const [k, old] of hits) if (old.reset <= now) hits.delete(k);
        hits.set(key, e = { count: 0, reset: now + windowMs });
      }
      e.count += 1;
      return e.count <= max ? 0 : Math.max(1, Math.ceil((e.reset - now) / 1000));
    },
    reset: (key) => hits.delete(key),
  };
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** createAuth({ store, curators, secureCookies, rateLimit: { max, ipMax, windowMs }, trustProxy }) */
export function createAuth({ store, curators = [], secureCookies = false, rateLimit = {}, trustProxy = false } = {}) {
  const curatorSet = new Set((typeof curators === 'string' ? curators.split(',') : curators)
    .map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  const limits = { max: 10, ipMax: 100, windowMs: 60_000, ...rateLimit };
  const perUser = createRateLimiter({ max: limits.max, windowMs: limits.windowMs });
  const perIp = createRateLimiter({ max: limits.ipMax, windowMs: limits.windowMs });
  let dummyHash = null; // verified against for unknown users so timing does not reveal them

  function clientIp(req) {
    if (trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      if (typeof xff === 'string' && xff.trim()) return xff.split(',').pop().trim();
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  function limitKey(req, username) {
    const name = typeof username === 'string' ? username.trim().toLowerCase().slice(0, 64) : '';
    return `${clientIp(req)}|${name}`;
  }

  /** Throws 429 when this IP (or IP + username) has tried too often. */
  function checkRateLimit(req, username) {
    const wait = Math.max(perIp.hit(clientIp(req)), perUser.hit(limitKey(req, username)));
    if (wait) throw new HttpError(429, 'Too many attempts. Try again in a minute.', { 'Retry-After': String(wait) });
  }

  const roleOf = (user) => (user && curatorSet.has(user.username) ? 'curator' : 'member');
  const publicUser = (user) => (user ? { id: user.id, username: user.username, role: roleOf(user) } : null);
  const findUser = (username) => store.users.list((u) => u.username === username)[0] ?? null;

  function checkPassword(password) {
    if (typeof password !== 'string' || password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters.');
    }
    if (password.length > MAX_PASSWORD) {
      throw new HttpError(400, `Password must be at most ${MAX_PASSWORD} characters.`);
    }
  }

  async function signup(req, body = {}) {
    checkRateLimit(req, body.username);
    const username = normalizeUsername(body.username);
    if (!username) throw new HttpError(400, 'Username must be 3–32 characters: letters, digits, _ or -.');
    checkPassword(body.password);
    if (findUser(username)) throw new HttpError(409, 'That username is taken.');
    const passwordHash = await hashPassword(body.password);
    if (findUser(username)) throw new HttpError(409, 'That username is taken.'); // lost a race during scrypt
    perUser.reset(limitKey(req, body.username));
    return store.users.create({ username, passwordHash });
  }

  async function login(req, body = {}) {
    checkRateLimit(req, body.username);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' && body.password.length <= MAX_PASSWORD ? body.password : '';
    const user = username ? findUser(username) : null;
    dummyHash ??= await hashPassword('not-a-real-password');
    const ok = await verifyPassword(password, user ? user.passwordHash : dummyHash);
    if (!user || !ok || !password) throw new HttpError(401, 'Wrong username or password.');
    perUser.reset(limitKey(req, body.username));
    return user;
  }

  function createSession(user) {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    store.sessions.create({ id: sha256(token), userId: user.id, expiresAt });
    // Keep each user's live sessions bounded; drop expired and the oldest extras.
    const mine = store.sessions.list((s) => s.userId === user.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    mine.forEach((s, i) => {
      if (i >= MAX_SESSIONS_PER_USER || Date.parse(s.expiresAt) <= now) store.sessions.remove(s.id);
    });
    return token;
  }

  const cookie = (value, maxAge) => [`${COOKIE_NAME}=${value}`, 'HttpOnly', 'SameSite=Lax', 'Path=/',
    `Max-Age=${maxAge}`, ...(secureCookies ? ['Secure'] : [])].join('; ');
  const sessionCookie = (token) => cookie(token, SESSION_TTL_MS / 1000);
  const clearCookie = () => cookie('', 0);

  function readToken(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  }

  /** → { user, session } for a valid session cookie, else null. `user` is the full record. */
  function authenticate(req) {
    const token = readToken(req);
    if (!token) return null;
    const session = store.sessions.get(sha256(token));
    if (!session) return null;
    const user = Date.parse(session.expiresAt) > Date.now() ? store.users.get(session.userId) : null;
    if (!user) {   // expired, or its user is gone
      store.sessions.remove(session.id);
      return null;
    }
    return { user, session };
  }

  function logout(req) {
    const token = readToken(req);
    if (token) store.sessions.remove(sha256(token));
  }

  function pruneSessions() {
    const now = Date.now();
    for (const s of store.sessions.list((s) => !(Date.parse(s.expiresAt) > now))) store.sessions.remove(s.id);
  }

  return { signup, login, logout, authenticate, createSession, sessionCookie, clearCookie, pruneSessions,
    checkRateLimit, clientIp, roleOf, publicUser, isCurator: (user) => roleOf(user) === 'curator' };
}
