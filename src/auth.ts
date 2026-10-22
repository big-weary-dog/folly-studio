// Accounts and sessions. Passwords: scrypt at OWASP's minimum cost (N = 2^17, r = 8, p = 1), a 16-byte salt each,
// compared with timingSafeEqual. Each hash carries its parameters, so one made at an older cost still verifies, and
// is made again at the current cost on its next successful login. Sessions: 32 random bytes in the `studio_session`
// cookie for 30 days (a guest's 7, at most MAX_GUESTS of them live, the oldest dropped first: anyone can make one);
// the store only sees sha256(token), the session's id. At most HASH_SLOTS hashes run at once
// (each takes 128 MiB) and HASH_QUEUE wait: past that, signup and login answer 429 rather than exhaust memory.
import { createHash, randomBytes, scrypt as scryptCb, type ScryptOptions, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { FastifyRequest } from 'fastify';

import { type Action, can } from '../shared/policy.ts';
import type { User } from '../shared/schemas/api.ts';
import { HttpError } from './http.ts';
import type { Store, StoredUser as Stored } from './store.ts';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, o: ScryptOptions) =>
  Promise<Buffer>;
export const COOKIE_NAME = 'studio_session';
const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY, GUEST_TTL_MS = 7 * DAY;
const MAX_SESSIONS_PER_USER = 20, MAX_GUESTS = 1000;
const HASH_SLOTS = 3, HASH_QUEUE = 30;
export type Cost = { N: number, r: number, p: number };
export const SCRYPT: Cost = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });
const KEYLEN = 64;
// scrypt takes 128 × N × r bytes (128 MiB at N = 2^17); Node refuses past maxmem, 32 MiB unless told.
const options = ({ N, r, p }: Cost): ScryptOptions => ({ N, r, p, maxmem: 128 * N * r + 32 * 1024 * 1024 });


/** `scrypt$N$r$p$salt$key` (base64url). */
export async function hashPassword(password: string, cost: Cost = SCRYPT): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFC'), salt, KEYLEN, options(cost));
  return ['scrypt', cost.N, cost.r, cost.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** The cost a stored hash was made with, if it is one of ours (and not absurd: a store is data too). */
export function costOf(stored: unknown): Cost | null {
  const [kind, N, r, p] = String(stored).split('$').map((x, i) => (i ? Number(x) : x));
  const ok = kind === 'scrypt' && Number.isInteger(N) && Number.isInteger(r) && Number.isInteger(p)
    && (N as number) > 1 && (N as number) <= 2 ** 20 && (r as number) <= 32 && (p as number) <= 16;
  return ok ? { N: N as number, r: r as number, p: p as number } : null;
}

export async function verifyPassword(password: unknown, stored: unknown): Promise<boolean> {
  const cost = costOf(stored);
  if (typeof password !== 'string' || !cost) return false;
  const [, , , , salt = '', keyB64 = ''] = String(stored).split('$');
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scrypt(password.normalize('NFC'), Buffer.from(salt, 'base64url'), expected.length, options(cost))
    .catch(() => null);
  return !!key && expected.length > 0 && timingSafeEqual(key, expected);
}

/** Was this hash made at less than `cost`? Then a login makes it again. */
export const weaker = (stored: string, cost: Cost) => {
  const was = costOf(stored);
  return !!was && (was.N < cost.N || was.r < cost.r || was.p < cost.p);
};

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const names = (list: string | string[]) => new Set((typeof list === 'string' ? list.split(',') : list)
  .map((s) => String(s).trim().toLowerCase()).filter(Boolean));

/**
 * createAuth({ store, curators, admins, cost, slots, queue, guests }): accounts, roles and sessions (cookies and limits
 * are the API's). Admins (STUDIO_ADMINS) choose the models on offer, and are curators too.
 */
export function createAuth({ store, curators = [], admins = [], cost = SCRYPT, slots = HASH_SLOTS,
  queue = HASH_QUEUE, guests = MAX_GUESTS }: {
  store: Pick<Store, 'users' | 'sessions'>, curators?: string | string[], admins?: string | string[], cost?: Cost,
  slots?: number, queue?: number, guests?: number }) {
  const curatorSet = names(curators), adminSet = names(admins);
  let dummyHash: Promise<string> | null = null; // checked for unknown users, so timing does not reveal them
  let hashing = 0;
  const waiting: (() => void)[] = [];
  /** Runs `work` (its hashing) in one of the slots, after those waiting; 429 when the line is full too. */
  async function slot<T>(work: () => Promise<T>) {
    if (hashing >= slots) {
      if (waiting.length >= queue) {
        throw new HttpError(429, 'The server is busy: try again in a moment.', { 'Retry-After': '5' });
      }
      await new Promise<void>((go) => waiting.push(go));
    } else hashing++;
    try { return await work(); } finally {
      const next = waiting.shift();
      if (next) next(); else hashing--;
    }
  }

  // A guest is a member whatever their name says (SPEC-access "Guests").
  const roleOf = (user: { username: string, guest?: true } | null): User['role'] => (!user || user.guest ? 'member'
    : adminSet.has(user.username) ? 'admin' : curatorSet.has(user.username) ? 'curator' : 'member');
  const publicUser = (user: Stored): User => ({ id: user.id, username: user.username, role: roleOf(user),
    ...(user.tour ? { tour: user.tour } : {}), ...(user.guest ? { guest: true } : {}) });
  const findUser = (username: string) => store.users.list((u) => u.username === username)[0] ?? null;

  async function signup({ username, password }: { username: string, password: string }) {
    if (findUser(username)) throw new HttpError(409, 'That username is taken.');
    const passwordHash = await slot(() => hashPassword(password, cost));
    if (findUser(username)) throw new HttpError(409, 'That username is taken.'); // lost a race during scrypt
    return store.users.create({ username, passwordHash });
  }

  const login = ({ username, password }: { username: string | null, password: string }) => slot(async () => {
    const user = username ? findUser(username) : null;
    dummyHash ??= hashPassword('not-a-real-password', cost);
    const ok = await verifyPassword(password, user ? user.passwordHash : await dummyHash);
    if (!user || !ok || !password) throw new HttpError(401, 'Wrong username or password.');
    if (weaker(user.passwordHash, cost)) {
      return store.users.update(user.id, { passwordHash: await hashPassword(password, cost) }) ?? user;
    }
    return user;
  });

  /** A new session for `user` → its token. Each user keeps at most 20, and guests all told `guests`: past that the
   * oldest go, as do expired ones. */
  function createSession(user: Stored) {
    const token = randomBytes(32).toString('base64url'), id = sha256(token);
    const now = Date.now(), cap = user.guest ? guests : MAX_SESSIONS_PER_USER;
    const expiresAt = new Date(now + (user.guest ? GUEST_TTL_MS : SESSION_TTL_MS)).toISOString();
    store.sessions.create({ id, userId: user.id, expiresAt, ...(user.guest ? { guest: user.username } : {}) });
    const others = store.sessions.list((s) => s.id !== id && (user.guest ? !!s.guest : s.userId === user.id))
      .sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
    others.forEach((s, i) => { if (i >= cap - 1 || Date.parse(s.expiresAt) <= now) store.sessions.remove(s.id); });
    return token;
  }

  /** A guest named `name` (already checked): a session's user, never stored as one. */
  const guest = (name: string, id = `guest-${randomBytes(12).toString('base64url')}`, at = new Date().toISOString()):
    Stored => ({ id, username: name, guest: true, passwordHash: '', createdAt: at, updatedAt: at });

  const valid = (token: unknown): token is string => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);

  /** → { user, session } for a live session token, else null. `user` is the full record. */
  function authenticate(token: unknown) {
    const session = valid(token) ? store.sessions.get(sha256(token)) : null;
    if (!session) return null;
    const user = !(Date.parse(session.expiresAt) > Date.now()) ? null
      : session.guest ? guest(session.guest, session.userId, session.createdAt) : store.users.get(session.userId);
    if (!user) {   // expired, or its user is gone
      store.sessions.remove(session.id);
      return null;
    }
    return { user, session };
  }

  const logout = (token: unknown) => { if (valid(token)) store.sessions.remove(sha256(token)); };

  function pruneSessions() {
    const now = Date.now();
    for (const s of store.sessions.list((x) => !(Date.parse(x.expiresAt) > now))) store.sessions.remove(s.id);
  }

  return { signup, login, guest, logout, authenticate, createSession, pruneSessions, roleOf, publicUser,
    /** shared/policy.ts's can(), by `user`'s role here. */
    can: (user: Stored | null, action: Action, look?: Parameters<typeof can>[2]) =>
      can(user && publicUser(user), action, look) };
}
export type Auth = ReturnType<typeof createAuth>;

const NEEDS = { admin: 'admin', curator: 'curate' } as const;
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
/**
 * The session (an onRequest hook): `req.user` from the cookie. A route needs a session unless it is `public` (401
 * without one), and its `role` when it names one (403). A guest only reads: their other requests are 403 but for the
 * public routes (signing in or out).
 */
export const sessionHook = (auth: Auth) => async (req: FastifyRequest) => {
  req.user = auth.authenticate(req.cookies[COOKIE_NAME])?.user ?? null;
  const { public: open, role } = req.routeOptions.config;
  if (!open && !req.user) throw new HttpError(401, 'Log in first.');
  if (!open && req.user?.guest && !READS.has(req.method)) {
    throw new HttpError(403, 'Guests can\'t save: log in or sign up for that.');
  }
  if (role && !auth.can(req.user, NEEDS[role])) throw new HttpError(403, `Only ${role}s can do that.`);
};
