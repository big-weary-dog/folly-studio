// The HTTP API's request bodies and what it answers with (SPEC "HTTP API"): accounts and looks. Bodies are
// parsed with these on the server; the browser takes the types (`import type`).
import { z } from 'zod';

import ACCOUNT from '../../public/data/account.json' with { type: 'json' };
import { ROLES, type Role } from '../policy.ts';
import type { Tour } from './tour.ts';
import { type Automation, Bpm, Duration, Globals, type Layer, Layers, LookTitle, Summary } from './look.ts';

/** A body's `chain`: 2 when its chains follow the one rule; without it they are converted (SPEC "Looks"). */
const Chain = z.literal(2, { error: 'chain must be 2 (warps bend what is above them).' }).optional();

const bool = (name: string) => z.boolean({ error: `${name} must be true or false.` });
const { usernameMin: USERNAME_MIN, usernameMax: USERNAME_MAX, passwordMin: PASSWORD_MIN,
  passwordMax: MAX_PASSWORD } = ACCOUNT;
const USERNAME = `Username must be ${USERNAME_MIN}–${USERNAME_MAX} characters: letters, digits, _ or -.`;
const PASSWORD = `Password must be at least ${PASSWORD_MIN} characters.`;

/** A username as stored: lower case, 3–32 of [a-z0-9_-]. */
export const Username = z.string({ error: USERNAME }).trim().toLowerCase()
  .regex(new RegExp(`^[a-z0-9_-]{${USERNAME_MIN},${USERNAME_MAX}}$`), { error: USERNAME });
const NewPassword = z.string({ error: PASSWORD }).min(PASSWORD_MIN, { error: PASSWORD })
  .max(MAX_PASSWORD, { error: `Password must be at most ${MAX_PASSWORD} characters.` });
export const Signup = z.object({ username: Username, password: NewPassword });
/** The account's own password, as a check: anything malformed is just wrong (spec/http "Your account"). */
const Current = z.string().max(MAX_PASSWORD).catch('');
/** PUT /api/me/password and DELETE /api/me. */
export const PasswordChange = z.object({ password: Current, next: NewPassword });
export const AccountDelete = z.object({ password: Current });
/** PUT /api/admin/accounts/:id (spec/http "People"). */
export const AccountChange = z.strictObject({
  role: z.enum(ROLES, { error: `role must be one of ${ROLES.join(', ')}.` }).optional(),
  disabled: z.boolean({ error: 'disabled must be true or false.' }).optional() });
/** An account as People lists it. */
export type Account = { id: string, username: string, role: Role, serverRole?: Role, createdAt: string,
  looks: number, shared: number, disabled: boolean };
const GUEST = 'A guest name is 1–24 letters, digits, spaces or _ . \' -.';
/** POST /api/guest: a guest's name, untrusted text shown only as text; Try it sends none (spec/http "Guests"). */
export const GuestBody = z.object({ name: z.string({ error: GUEST }).trim().normalize('NFC')
  .regex(/^[\p{L}\p{N} _.'-]{1,24}$/u, { error: GUEST }).default('Visitor') });
/** A login never says which part was wrong: a malformed name or password is just a wrong one. */
export const Login = z.object({
  username: Username.nullable().catch(null), password: z.string().max(MAX_PASSWORD).catch(''),
}).catch({ username: null, password: '' });

/** POST /api/looks. `automation` is checked against the look's globals (automationFor). */
export const LookCreate = z.object({
  title: LookTitle, summary: Summary, layers: Layers, duration: Duration.optional(), globals: Globals.optional(),
  automation: z.unknown().optional(), bpm: Bpm.optional(), shared: bool('shared').default(false), chain: Chain,
  /** An import's look, by its id where it was made (spec/looks "Look files"). */
  origin: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, { error: 'origin is not a look id.' }).optional(),
});
const NAME = 'A version\'s name is 1–80 characters.';
/** A version's name (spec/looks "Named versions"): naming one keeps it. */
const VersionName = z.string({ error: NAME }).trim().min(1, { error: NAME }).max(80, { error: NAME });
const REASON = 'flashOverride: say in 3–500 characters why this flashing is acceptable.';
/** PUT /api/looks/:id: what changes; null clears bpm, globals and automation. `flashOverride` (with reviewed: true):
 * a curator's reason for approving a bake that fails the flash check. `reviewed` and `hidden` are a curator's. */
export const LookPatch = z.object({
  title: LookTitle.optional(), summary: Summary.optional(), shared: bool('shared').optional(),
  bpm: Bpm.optional(), layers: Layers.optional(), duration: Duration.optional(), globals: Globals.optional(),
  automation: z.unknown().optional(), reviewed: bool('reviewed').optional(), hidden: bool('hidden').optional(),
  chain: Chain,
  flashOverride: z.string({ error: REASON }).trim().min(3, { error: REASON }).max(500, { error: REASON }).optional(),
  restoredFrom: z.number({ error: 'restoredFrom must be a version number.' }).int().min(1).optional(),
  versionName: VersionName.optional(),
});
/** PUT /api/looks/:id/versions/:n: name a version (it is kept), or `null` to unname it. */
export const VersionNamePatch = z.object({ name: VersionName.nullable() });
export const LooksQuery = z.object({
  scope: z.enum(['mine', 'gallery'], { error: 'scope must be mine or gallery.' }).default('mine'),
  versions: z.string().optional(),
});

// What the API answers with (it never reads these back): an account, the flash check's settings, a look as lists and
// GET show it.
/** `guest`: a guest's session, not an account (spec/http "Guests"). */
export type User = { id: string, username: string, role: Role, tour?: Tour, guest?: true };
/** GET /api/me's `flash`: whether the flash check runs here, and its limits (SPEC "Baked frames" > Checks). */
export type FlashSettings = { check: boolean, perSecond: number, delta: number, darker: number, area: number };
/** A curator's approval of a look whose bake fails the flash check: why, who, when. */
export type FlashOverride = { reason: string, by: string, at: string };
export type LookCreate = z.input<typeof LookCreate>;
export type LookPatch = z.input<typeof LookPatch>;
/** A look as lists show it: what a card needs, no layers or code. */
export type Listed = { id: string, owner: string, ownerName: string, title: string, summary: string, duration: number,
  layerCount: number, shared: boolean, reviewed: boolean, hidden: boolean, bpm?: number, sharedAt?: string,
  preview?: string, createdAt: string, updatedAt: string };
/** A look as GET /api/looks/:id answers; `version` (its owner's only): the number of the version it is. */
export type Look = Omit<Listed, 'layerCount'> & { layers: Layer[], globals?: z.infer<typeof Globals>,
  automation?: Automation, versionCount: number, version?: number, bake?: Bake | null, reviewedBy?: string,
  hiddenBy?: string,
  flashOverride?: FlashOverride, chain?: 2, origin?: string };

/** How a version was made (spec/looks "Versions"): a save, an AI refinement, a restore of version `from`, or a look
 * file overruling it. */
export type VersionHow = 'auto' | 'ai' | 'restore' | 'import';
/** What a version is besides its content: its number, how it was made, its name (named ones are kept), the round. */
export type VersionMeta = { n: number, how?: VersionHow, name?: string, from?: number, ideaId?: string,
  ask?: string };
/** A version as GET /api/looks/:id/versions lists it: `current` the look as saved; `palette` a few of its colours;
 * `tempoGuessed` when it was kept before versions held the tempo (its bpm is the look's). */
export type VersionListed = VersionMeta & { how: VersionHow, savedAt: string, title: string, layerCount: number,
  duration: number, bpm: number | null, tempoGuessed?: true, reviewed: boolean, current?: true, shared?: boolean,
  palette: string[] };
/** A version with what it plays: GET /api/looks/:id/versions/:n. */
export type Version = VersionListed & { summary: string, layers: Layer[], globals?: z.infer<typeof Globals> | null,
  automation?: Automation | null };

type Flashes = { maxHz: number, flaggedSeconds: number[], regions: string[] };
/** What the frame checks found (SPEC "Baked frames" > Checks: src/frames.ts analyzeFrames). */
export type Analysis = { frames: number, seconds: number, fps: number, channels: number, sparse: boolean,
  pixels: number, coverage: number, peakBrightness: number, meanBrightness: number, darkFraction: number,
  estPeakAmps: number, flicker: Flashes & { ok: boolean, small: Flashes,
    limits?: { perSecond: number, delta: number, area: number } } };
/** A look's bake as stored (SPEC "Baked frames" > Stored); `boxStats` is what the box said, kept as untrusted. */
export type Bake = { source: 'render-box', status: 'queued' | 'running' | 'done' | 'failed', ok: boolean,
  reason?: string, warning?: string, checkedAt?: string, requestedAt?: string, startedAt?: string, layersHash?: string,
  renderKey?: string, seconds?: number, analysis?: Analysis, frames?: { bytes: number, sha256: string },
  boxStats?: { untrusted: true, reported: unknown } };

/** The bake setting (SPEC "Baked frames", "The bake setting"), as Admin → Baking saves it. */
export const BAKE_MODES = ['on', 'throttled', 'off'] as const;
export const Baking = z.strictObject({
  mode: z.enum(BAKE_MODES, { error: 'mode must be on, throttled or off.' }),
}, { error: 'The bake setting must be { mode }.' });
export type BakeMode = typeof BAKE_MODES[number];
/** GET /api/baking: the setting and whether the render box runs here. */
export type BakingState = { mode: BakeMode, box: { ok: boolean, reason?: string } };

/** GET /api/admin/stats (spec/http "Stats"): since the server started; `days` newest first, at most 7. */
export type StatsDay = { day: string, visitors: number, people: number, views: number, requests: number,
  errors: number, slow: number };
export type ServerStats = { startedAt: string, uptime: number, memory: { rss: number, heap: number }, load: number,
  days: StatsDay[], slowest: { at: string, method: string, route: string, status: number, ms: number }[],
  bakes: { done: number, failed: number, waiting: number } };
