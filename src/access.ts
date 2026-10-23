// Who may use the paid models, and how much (SPEC-access "Access"). A paid model (every via today) needs an unlocked
// account: an invite code redeemed, an admin's say, or `inviteOnly: false`. Each account's ideas are counted when
// POST /api/ideas accepts them (one idea, one use, whatever its job does; a Deep idea DEEP.uses), over rolling hours
// and days, against the registry's limits, a model's own, and a daily ceiling across everyone. Admins are exempt.
// Invite codes are kept as sha256 of the code: the code is answered once, at creation.
import { randomInt } from 'node:crypto';

import {
  type Access, GlobalLimits, type Invite, type Person, type PersonLimits, type Used, type UserAccess,
} from '../shared/schemas/access.ts';
import { isPending } from '../shared/idea-status.ts';
import { DEEP, type Explore, type Idea } from '../shared/schemas/api.ts';
import { isPaid, type ModelEntry } from '../shared/schemas/models.ts';
import { type Auth, sha256 } from './auth.ts';
import { stamp } from './clock.ts';
import type { Registry } from './generate/models.ts';
import type { Store, StoredInvite, StoredUser } from './store.ts';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** A code as typed → as hashed: upper case, without spaces or dashes. */
const normalise = (code: string) => code.toUpperCase().replace(/[\s-]+/g, '');
const newCode = () => Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  .replace(/(.{4})(?=.)/g, '$1-');
const DEFAULTS = GlobalLimits.parse({});

/** A refusal: the status, the words, the account's access and, for 429, when to try again (s). */
export type Refusal = { status: 403 | 429, error: string, access: Access, retryAfter?: number };
/** Why a code was not redeemed: no such code, or no longer active. */
export type Refused = { refused: 'unknown' | Exclude<Invite['state'], 'active'> };
type Counted = { at: number, model?: string, paid: boolean, running: boolean };

/** When a window of `ms` capped at `cap` has room for `uses` again, given its uses' times (ascending); 0: now. */
const freesAt = (times: number[], cap: number, ms: number, uses = 1) => (times.length + uses <= cap ? 0
  : cap >= uses ? times[times.length - cap + uses - 1]! + ms : Infinity);
/** The uses one idea counts as. */
const usesOf = (explore?: Explore) => (explore === 'deep' ? DEEP.uses : 1);

export function createAccess({ store, auth, models }: { store: Pick<Store, 'users' | 'ideas' | 'invites'>,
  auth: Auth, models: Registry | null }) {
  const limits = () => models?.config().limits ?? DEFAULTS;
  /** Paid: its model is one (a model no longer listed counts, as it once ran). Ideas from before the registry not. */
  const paid = (i: Idea) => {
    const m = i.model ? models?.get(i.model) : undefined;
    return !!i.model && (!m || isPaid(m));
  };
  const exempt = (u: StoredUser) => auth.can(u, 'admin');
  const unlocked = (u: StoredUser) => !limits().inviteOnly || exempt(u) || !!u.access?.unlockedAt;
  const capsOf = (u: StoredUser) => {
    const g = limits(), own = u.access?.limits ?? {};
    return { perHour: own.perHour ?? g.perHour, perDay: own.perDay ?? g.perDay, concurrent: own.concurrent
      ?? g.concurrent };
  };

  /** This account's ideas that count: in the last day and since its reset, and any still being made. */
  function counted(u: StoredUser, now: number): Counted[] {
    const from = Math.max(now - DAY_MS, Date.parse(u.access?.resetAt ?? '') || 0);
    return store.ideas.list((i) => i.owner === u.id).flatMap((i) => Array.from({ length: usesOf(i.explore) },
      (_, n) => ({ at: Date.parse(i.createdAt), model: i.model, paid: paid(i),
        running: n === 0 && isPending(i) })))
      .filter((c) => c.at > from || c.running);
  }
  const usedOf = (list: Counted[], now: number): Used & { hours: number[], days: number[] } => {
    const days = list.filter((c) => c.at > now - DAY_MS).map((c) => c.at).sort((a, b) => a - b);
    const hours = days.filter((t) => t > now - HOUR_MS);
    return { hour: hours.length, day: days.length, running: list.filter((c) => c.running).length, hours, days };
  };
  const ceilingTimes = (now: number) => store.ideas.list((i) => Date.parse(i.createdAt) > now - DAY_MS && paid(i))
    .flatMap((i) => Array(usesOf(i.explore)).fill(Date.parse(i.createdAt)) as number[]).sort((a, b) => a - b);

  /** GET /api/me's `access`. */
  function state(u: StoredUser, now = Date.now()): Access {
    const list = counted(u, now), caps = capsOf(u), mine = usedOf(list.filter((c) => c.paid), now);
    const left = { hour: Math.max(0, caps.perHour - mine.hour), day: Math.max(0, caps.perDay - mine.day),
      running: Math.max(0, caps.concurrent - mine.running) };
    const ceiling = ceilingTimes(now), full = ceiling.length >= limits().dailyCeiling;
    const next = Math.max(freesAt(mine.hours, caps.perHour, HOUR_MS), freesAt(mine.days, caps.perDay, DAY_MS),
      full ? freesAt(ceiling, limits().dailyCeiling, DAY_MS) : 0);
    const own: NonNullable<Access['models']> = {};
    const capped = models?.config().models.filter((x) => x.limits?.perHour != null || x.limits?.perDay != null) ?? [];
    for (const m of capped) {
      const used = usedOf(list.filter((c) => c.model === m.id), now);
      const { perHour, perDay } = m.limits!;
      own[m.id] = { ...(perHour != null ? { hour: Math.max(0, perHour - used.hour) } : {}),
        ...(perDay != null ? { day: Math.max(0, perDay - used.day) } : {}) };
    }
    return { unlocked: unlocked(u), exempt: exempt(u), inviteOnly: limits().inviteOnly, limits: caps, left,
      ...(next > now && Number.isFinite(next) ? { nextAt: new Date(next).toISOString() } : {}),
      ...(full ? { full: true } : {}), ...(Object.keys(own).length ? { models: own } : {}) };
  }

  /** Why `u` may not send an idea to `m` (at `explore`) now, or null. Runs with the create, no await between. */
  function check(u: StoredUser, m: ModelEntry, now = Date.now(), explore?: Explore): Refusal | null {
    if (exempt(u)) return null;
    const access = state(u, now), list = counted(u, now), uses = usesOf(explore);
    // A cap of 0 never frees (at is Infinity): no Retry-After, no "try again".
    const refuse = (status: 403 | 429, error: string, at = 0): Refusal => ({ status, error, access,
      ...(status === 429 && Number.isFinite(at)
        ? { retryAfter: Math.max(1, Math.ceil(((at || now + 30_000) - now) / 1000)) } : {}) });
    const later = (at: number) => (Number.isFinite(at)
      ? ` Try again in ${Math.max(1, Math.round((at - now) / 60_000))} min.` : '');
    const none = (what: string) => refuse(429, `Your allowance for ideas ${what} is 0: ask an admin.`, Infinity);
    const caps = isPaid(m) ? capsOf(u) : null;
    if (caps && !access.unlocked) {
      return refuse(403, `${m.label} needs an invite code. Browsing, editing and the gallery are free.`);
    }
    const own = m.limits ?? {}, of = usedOf(list.filter((c) => c.model === m.id), now);
    const pool = caps ? usedOf(list.filter((c) => c.paid), now) : of;
    if (caps?.concurrent === 0 || own.concurrent === 0) return none('at once');
    if (pool.running >= (caps?.concurrent ?? Infinity) || of.running >= (own.concurrent ?? Infinity)) {
      return refuse(429, 'You have ideas being made already. Send this one when one is done.');
    }
    for (const [cap, times, ms, when] of [[caps?.perHour, pool.hours, HOUR_MS, 'this hour'],
      [caps?.perDay, pool.days, DAY_MS, 'today'], [own.perHour, of.hours, HOUR_MS, `on ${m.label} this hour`],
      [own.perDay, of.days, DAY_MS, `on ${m.label} today`]] as const) {
      if (cap === 0) return none(when);
      if (cap != null && times.length + uses > cap) {
        const at = freesAt(times, cap, ms, uses);
        return refuse(429, uses > 1 && times.length < cap
          ? `A Deep idea counts as ${uses}, and you have ${cap - times.length} left ${when}.${later(at)}`
          : `That's your ${cap} ideas ${when}.${later(at)}`, at);
      }
    }
    const ceiling = ceilingTimes(now);
    if (caps && ceiling.length + uses > limits().dailyCeiling) {
      const at = freesAt(ceiling, limits().dailyCeiling, DAY_MS, uses);
      return refuse(429, `The AI models have done all they can for today.${later(at)}`, at);
    }
    return null;
  }

  const inviteOf = (x: StoredInvite, now = Date.now()): Invite => {
    const { hash: _h, updatedAt: _u, ...rest } = x;
    const state = x.revokedAt ? 'revoked' : x.expiresAt && Date.parse(x.expiresAt) <= now ? 'expired'
      : x.used >= x.uses ? 'used' : 'active';
    return { ...rest, state };
  };

  return {
    state, check,
    /** Redeem a code → the account's access, or why it is no usable code (the attempt counts as failed). */
    redeem(user: StoredUser, code: string): Access | Refused {
      const u = store.users.get(user.id) ?? user;   // as stored now: a request alongside may have unlocked it
      if (unlocked(u) && u.access?.unlockedAt) return state(u);
      const hash = sha256(normalise(code));
      const found = normalise(code).length === 12 ? store.invites.list((x) => x.hash === hash)[0] : undefined;
      if (!found) return { refused: 'unknown' };
      const now = inviteOf(found).state;
      if (now !== 'active') return { refused: now };
      store.invites.update(found.id, { used: found.used + 1 });
      const access: UserAccess = { ...u.access, unlockedAt: stamp(), invite: found.id };
      return state(store.users.update(u.id, { access })!);
    },
    invites: () => store.invites.list().map((x) => inviteOf(x)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    createInvite(by: string, { label, uses, days }: { label?: string, uses: number, days?: number }) {
      const code = newCode();
      const made = store.invites.create({ hash: sha256(normalise(code)), uses, used: 0, createdBy: by,
        ...(label ? { label } : {}),
        ...(days ? { expiresAt: new Date(Date.now() + days * DAY_MS).toISOString() } : {}) });
      return { invite: inviteOf(made), code };
    },
    revoke(id: string) {
      const x = store.invites.get(id);
      if (!x) return null;
      return inviteOf(x.revokedAt ? x : store.invites.update(id, { revokedAt: stamp() })!);
    },
    person(u: StoredUser, now = Date.now()): Person {
      const { hour, day, running } = usedOf(counted(u, now).filter((c) => c.paid), now);
      return { id: u.id, username: u.username, role: auth.roleOf(u), access: u.access ?? {},
        used: { hour, day, running } };
    },
    /** An admin's change to one person: unlock or lock, an override of their limits (null clears), a reset. */
    patch(u: StoredUser, by: string, p: { unlocked?: boolean, limits?: PersonLimits | null, reset?: true }) {
      const next: UserAccess = { ...u.access };
      if (p.unlocked === true && !next.unlockedAt) Object.assign(next, { unlockedAt: stamp(), by });
      if (p.unlocked === false) { delete next.unlockedAt; delete next.invite; delete next.by; }
      if (p.limits === null) delete next.limits;
      else if (p.limits) next.limits = p.limits;
      if (p.reset) next.resetAt = stamp();
      return store.users.update(u.id, { access: next })!;
    },
  };
}
export type AccessControl = ReturnType<typeof createAccess>;
