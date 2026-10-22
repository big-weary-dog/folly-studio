// The HTTP API's request bodies and what it answers with (SPEC "HTTP API"): accounts, ideas and looks. Bodies are
// parsed with these on the server; the browser takes the types (`import type`).
import { z } from 'zod';

import ACCOUNT from '../../public/data/account.json' with { type: 'json' };
import type { IdeaStatus } from '../idea-status.ts';
import type { Tour } from './tour.ts';
import { type Automation, Bpm, Duration, Globals, type Layer, Layers, LookTitle, Summary } from './look.ts';
import type { Role } from './models.ts';

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
export const Signup = z.object({
  username: Username,
  password: z.string({ error: PASSWORD }).min(PASSWORD_MIN, { error: PASSWORD })
    .max(MAX_PASSWORD, { error: `Password must be at most ${MAX_PASSWORD} characters.` }),
});
/** A login never says which part was wrong: a malformed name or password is just a wrong one. */
export const Login = z.object({
  username: Username.nullable().catch(null), password: z.string().max(MAX_PASSWORD).catch(''),
}).catch({ username: null, password: '' });

/** How much a generator explores before it commits (SPEC-generators "Explore"); an idea without one explores. */
export const EXPLORE = ['quick', 'explore', 'deep'] as const;
export type Explore = typeof EXPLORE[number];
/** What a Deep idea costs: `uses` against an account's limits; whether only admins may ask for it; whether anyone
 * may (off: the API refuses it and the Studio does not offer it). */
export const DEEP = { uses: 2, adminOnly: false, enabled: false };
export const IdeaBody = z.object({
  text: z.string({ error: 'Describe the idea in 3–2000 characters.' }).trim()
    .min(3, { error: 'Describe the idea in 3–2000 characters.' })
    .max(2000, { error: 'Describe the idea in 3–2000 characters.' }),
  /** A model id (shared/schemas/models.ts); none: the registry's default. */
  model: z.string({ error: 'model must name one of the models.' })
    .max(32, { error: 'model must name one of the models.' }).optional(),
  explore: z.enum(EXPLORE, { error: 'explore must be quick, explore or deep.' }).default('explore'),
});
/** POST /api/looks/:id/refine: the change asked for; or a critique, or a runtime error to fix, with no text. */
export const RefineBody = z.object({
  text: z.string({ error: 'Describe the change in at most 1000 characters.' }).trim()
    .max(1000, { error: 'Describe the change in at most 1000 characters.' }).default(''),
  model: IdeaBody.shape.model,
  critique: z.boolean({ error: 'critique must be true or false.' }).optional(),
  fix: z.object({ layer: z.string().trim().min(1).max(80), error: z.string().trim().min(1).max(400) },
    { error: 'fix is { layer, error }.' }).optional(),
}).refine((b) => b.text.length >= 2 || b.critique || b.fix, { error: 'Describe the change first.' });

/** POST /api/looks. `automation` is checked against the look's globals (automationFor). */
export const LookCreate = z.object({
  title: LookTitle, summary: Summary, layers: Layers, duration: Duration.optional(), globals: Globals.optional(),
  automation: z.unknown().optional(), bpm: Bpm.optional(), shared: bool('shared').default(false), chain: Chain,
  ideaId: z.string({ error: 'ideaId does not name one of your ideas.' }).nullish(),
});
const NAME = 'A version\'s name is 1–80 characters.';
/** A version's name (SPEC-history "Named versions"): naming one keeps it. */
const VersionName = z.string({ error: NAME }).trim().min(1, { error: NAME }).max(80, { error: NAME });
const REASON = 'flashOverride: say in 3–500 characters why this flashing is acceptable.';
/** PUT /api/looks/:id: what changes; null clears bpm, globals and automation. `flashOverride` (with reviewed: true):
 * a curator's reason for approving a bake that fails the flash check. */
export const LookPatch = z.object({
  title: LookTitle.optional(), summary: Summary.optional(), shared: bool('shared').optional(),
  bpm: Bpm.optional(), layers: Layers.optional(), duration: Duration.optional(), globals: Globals.optional(),
  automation: z.unknown().optional(), reviewed: bool('reviewed').optional(), chain: Chain,
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

// What the API answers with (it never reads these back): an account, the flash check's settings, an idea, a look as
// lists and GET show it.
export type User = { id: string, username: string, role: Role, tour?: Tour };
/** GET /api/me's `flash`: whether the flash check runs here, and its limits (SPEC "Baked frames" > Checks). */
export type FlashSettings = { check: boolean, perSecond: number, delta: number, darker: number, area: number };
/** A curator's approval of a look whose bake fails the flash check: why, who, when. */
export type FlashOverride = { reason: string, by: string, at: string };
/** Where a generation's time went, in ms: in the queue, building the prompt, the model's request, parsing; the render
 * check and the critique round, when they ran; and the tokens its calls used (`input` counts the `cached`). */
export type Timing = { wait: number, prompt: number, request: number, parse: number, total: number, check?: number,
  critique?: number, draft?: number, tokens?: { input: number, cached: number, output: number } };
/** One round of a prompted model's idea (SPEC-generators "The idea log"): compose, repair, critique, … */
export type IdeaRound = { kind: string, ms: number, outcome?: string };
/** A change a round made (`+ layer Rose (bars)`, `Rose: speed 0.2 → 0.5`) and the model's why for it. */
export type HowChange = { text: string, why?: string };
/** What the render check after a round found: ms a frame's render took, errors, and the frame checks' numbers. */
export type HowChecks = { ms: number, errors: number, meanBrightness?: number, darkFraction?: number,
  flashHz?: number, flashOk?: boolean };
/** A still the model was shown: its file in the idea's log, the view (front, or a group's close-up), its time (s). */
export type HowStill = { file: string, view: string, at: number };
/** A round as "How it was made" shows it (SPEC-generators "The idea log"): the model's critique, plan and thinking
 * summary, what it changed, what the checks found, the stills it was shown (how many, once the log is gone), the
 * docs it read and the critique's group warnings; for admins, expand's notes, why a repair ran and its dollars. */
export type HowRound = { n: number, kind: string, ms: number, outcome?: string,
  tokens?: { input: number, cached: number, output: number, reasoning: number }, critique?: string, plan?: string,
  thinking?: string, changes?: HowChange[], checks?: HowChecks, stills?: number | HowStill[], docs?: string[],
  warnings?: string[], notes?: string[], reason?: string[], usd?: number };
/** A part of what the model was first asked: its size, about how many tokens, and its text where the viewer may read
 * it (the shared guide and catalog, admins only). */
export type HowPart = { name: string, bytes: number, tokens: number, text?: string };
/** GET /api/ideas/:id/how: the idea, how its model ran, the prompt's parts and the rounds, `from` the idea's log, the
 * summary the idea keeps, or neither; `usd` (admins) what it cost. */
export type IdeaHow = { idea: Idea, from: 'log' | 'idea' | 'none',
  run: { via?: string, effort?: string, level?: string, name?: string }, prompt?: HowPart[], rounds: HowRound[],
  usd?: number };
/** GET /api/ideas/:id/how/live: the idea's status, how many rounds have ended, and the one running now (thinking so
 * far); polled while the idea runs, the page fetching /how again when `rounds` or `status` moves. */
export type IdeaHowLive = { status: IdeaStatus, rounds: number,
  round?: { n: number, kind: string, ms: number, thinking?: string } };
/** What a refinement asks besides its text (SPEC-generators "Refine"). */
export type RefineAsk = { critique?: true, fix?: { layer: string, error: string } };
/** `model`: the model asked for; `generator`: the one that made the look (a fallback's, if it took over); `by`: its
 * label as shown ("by <label>"); `explore`: how much it explores (a prompted model's); `took`: what its look took from
 * each draft; `rounds`: what its rounds did; `how`: how it was made, kept with the idea (GET /api/ideas/:id/how). */
export type Idea = { id: string, owner: string, text: string, status: IdeaStatus,
  model?: string, generator: string, by?: string, explore?: Explore, took?: string, timing?: Timing, lookId?: string,
  refine?: RefineAsk, changes?: string[], verdict?: string, undone?: true, error?: string | null, createdAt: string,
  rounds?: IdeaRound[], how?: HowRound[],
  updatedAt: string };
export type LookCreate = z.input<typeof LookCreate>;
export type LookPatch = z.input<typeof LookPatch>;
/** A look as lists show it: what a card needs, no layers or code. */
export type Listed = { id: string, owner: string, ownerName: string, title: string, summary: string, duration: number,
  layerCount: number, shared: boolean, reviewed: boolean, bpm?: number, sharedAt?: string, ideaId?: string,
  preview?: string, createdAt: string, updatedAt: string };
/** A look as GET /api/looks/:id answers; `version` (its owner's only): the number of the version it is. */
export type Look = Omit<Listed, 'layerCount'> & { layers: Layer[], globals?: z.infer<typeof Globals>,
  automation?: Automation, versionCount: number, version?: number, bake?: Bake | null, reviewedBy?: string,
  flashOverride?: FlashOverride, chain?: 2 };

/** How a version was made (SPEC-history "Versions"): a save, an AI refinement, or a restore of version `from`. */
export type VersionHow = 'auto' | 'ai' | 'restore';
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
export type Bake = { source: 'render-box' | 'fleet-box', status: 'queued' | 'running' | 'done' | 'failed', ok: boolean,
  reason?: string, warning?: string, checkedAt?: string, requestedAt?: string, startedAt?: string, layersHash?: string,
  renderKey?: string, seconds?: number, analysis?: Analysis, frames?: { bytes: number, sha256: string },
  boxStats?: { untrusted: true, reported: unknown } };

/** The bake setting (SPEC "Baked frames", "The bake setting"), as Admin → Baking saves it. */
export const BAKE_MODES = ['on', 'throttled', 'off'] as const;
export const Baking = z.strictObject({
  mode: z.enum(BAKE_MODES, { error: 'mode must be on, throttled or off.' }),
  customCode: z.boolean({ error: 'customCode must be true or false.' }).optional(),
}, { error: 'The bake setting must be { mode, customCode? }.' });
/** PUT /api/admin/baking: either or both. */
export const BakingPatch = Baking.partial().refine((b) => b.mode !== undefined || b.customCode !== undefined,
  { error: 'The bake setting must be { mode?, customCode? }.' });
export type BakeMode = typeof BAKE_MODES[number];
/** GET /api/baking: the setting and what the render box can do here. */
export type BakingState = { mode: BakeMode, customCode: boolean, box: { ok: boolean, libraryOnly: boolean,
  reason?: string } };

/** GET /api/admin/stats (SPEC-access "Stats"): since the server started; `days` newest first, at most 7. */
export type StatsDay = { day: string, visitors: number, people: number, views: number, requests: number,
  errors: number, slow: number };
export type ServerStats = { startedAt: string, uptime: number, memory: { rss: number, heap: number }, load: number,
  days: StatsDay[], slowest: { at: string, method: string, route: string, status: number, ms: number }[],
  bakes: { done: number, failed: number, waiting: number },
  ideas?: { made: number, failed: number, waiting: number } };
