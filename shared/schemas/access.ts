// Who may use the paid models, and how much (SPEC-access): the registry's limits, invite codes and an admin's say
// over one person. The server parses bodies with these; the browser takes the types.
import { z } from 'zod';

import type { Role } from './models.ts';

const int = (name: string, lo: number, hi: number) => z.int({ error: `${name} must be a whole number.` })
  .min(lo, { error: `${name} must be at least ${lo}.` }).max(hi, { error: `${name} must be at most ${hi}.` });

/** One person's caps: ideas in the last hour and 24 hours, and ideas queued or generating at once. */
export const PersonLimits = z.strictObject({
  perHour: int('perHour', 0, 1000).optional(), perDay: int('perDay', 0, 10_000).optional(),
  concurrent: int('concurrent', 0, 16).optional(),
});
export type PersonLimits = z.output<typeof PersonLimits>;

/** The defaults, the owner's to tune in models.json: an idea takes 20–60 s, so 6 an hour lets someone iterate
 * through a sitting; 20 a day was the cap before; 2 at once keeps one person from filling the claude lane's 4;
 * 200 a day across everyone is ~10 people at their full allowance, a spend backstop under the API key's own. */
export const LIMITS = { inviteOnly: true, perHour: 6, perDay: 20, concurrent: 2, dailyCeiling: 200 };
export const GlobalLimits = z.strictObject({
  inviteOnly: z.boolean({ error: 'limits.inviteOnly must be true or false.' }).default(LIMITS.inviteOnly),
  perHour: int('limits.perHour', 0, 1000).default(LIMITS.perHour),
  perDay: int('limits.perDay', 0, 10_000).default(LIMITS.perDay),
  concurrent: int('limits.concurrent', 0, 16).default(LIMITS.concurrent),
  dailyCeiling: int('limits.dailyCeiling', 0, 100_000).default(LIMITS.dailyCeiling),
});
export type GlobalLimits = z.output<typeof GlobalLimits>;

const CODE = 'That is not an invite code.';
/** POST /api/invite: a code as typed (case, spaces and dashes do not matter). */
export const Redeem = z.object({ code: z.string({ error: CODE }).max(64, { error: CODE }) });
export const InviteCreate = z.object({
  label: z.string({ error: 'label must be text.' }).trim().max(60, { error: 'label must be at most 60 characters.' })
    .optional(),
  uses: int('uses', 1, 1000).default(1),
  days: int('days', 1, 365).optional(),
});
export const PersonPatch = z.object({
  unlocked: z.boolean({ error: 'unlocked must be true or false.' }).optional(),
  limits: PersonLimits.nullable().optional(),
  reset: z.literal(true, { error: 'reset must be true.' }).optional(),
});

// What the API answers with.
export type Used = { hour: number, day: number, running: number };
/** GET /api/me's `access`, and a 403's or 429's from POST /api/ideas. */
export type Access = { unlocked: boolean, exempt: boolean, inviteOnly: boolean,
  limits: { perHour: number, perDay: number, concurrent: number }, left: Used, nextAt?: string, full?: boolean,
  models?: Record<string, { hour?: number, day?: number }> };
/** A stored user's `access`. */
export type UserAccess = { unlockedAt?: string, invite?: string, by?: string, limits?: PersonLimits,
  resetAt?: string };
export type Invite = { id: string, label?: string, uses: number, used: number, expiresAt?: string, revokedAt?: string,
  createdBy: string, createdAt: string, state: 'active' | 'used' | 'expired' | 'revoked' };
export type Person = { id: string, username: string, role: Role, access: UserAccess,
  used: Used };
