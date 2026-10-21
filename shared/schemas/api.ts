// The HTTP API's request bodies and what it answers with (SPEC "HTTP API"): accounts, ideas and looks. Bodies are
// parsed with these on the server; the browser takes the types (`import type`).
import { z } from 'zod';

import ACCOUNT from '../../public/data/account.json' with { type: 'json' };
import type { IdeaStatus } from '../idea-status.ts';
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
const REASON = 'flashOverride: say in 3–500 characters why this flashing is acceptable.';
/** PUT /api/looks/:id: what changes; null clears bpm, globals and automation. `flashOverride` (with reviewed: true):
 * a curator's reason for approving a bake that fails the flash check. */
export const LookPatch = z.object({
  title: LookTitle.optional(), summary: Summary.optional(), shared: bool('shared').optional(),
  bpm: Bpm.optional(), layers: Layers.optional(), duration: Duration.optional(), globals: Globals.optional(),
  automation: z.unknown().optional(), reviewed: bool('reviewed').optional(), chain: Chain,
  flashOverride: z.string({ error: REASON }).trim().min(3, { error: REASON }).max(500, { error: REASON }).optional(),
});
export const LooksQuery = z.object({
  scope: z.enum(['mine', 'gallery'], { error: 'scope must be mine or gallery.' }).default('mine'),
  versions: z.string().optional(),
});

// What the API answers with (it never reads these back): an account, the flash check's settings, an idea, a look as
// lists and GET show it.
export type User = { id: string, username: string, role: 'member' | 'curator' | 'admin' };
/** GET /api/me's `flash`: whether the flash check runs here, and its limits (SPEC "Baked frames" > Checks). */
export type FlashSettings = { check: boolean, perSecond: number, delta: number, darker: number, area: number };
/** A curator's approval of a look whose bake fails the flash check: why, who, when. */
export type FlashOverride = { reason: string, by: string, at: string };
/** Where a generation's time went, in ms: in the queue, building the prompt, the model's request, parsing; the render
 * check and the critique round, when they ran; and the tokens its calls used (`input` counts the `cached`). */
export type Timing = { wait: number, prompt: number, request: number, parse: number, total: number, check?: number,
  critique?: number, sketch?: number, tokens?: { input: number, cached: number, output: number } };
/** One round of a prompted model's idea (SPEC-generators "The idea log"): compose, repair, critique, … */
export type IdeaRound = { kind: string, ms: number, outcome?: string };
/** What a refinement asks besides its text (SPEC-generators "Refine"). */
export type RefineAsk = { critique?: true, fix?: { layer: string, error: string } };
/** `model`: the model asked for; `generator`: the one that made the look (a fallback's, if it took over); `by`: its
 * label as shown ("by <label>"); `explore`: how much it explores (a prompted model's); `took`: what its look took from
 * each sketch; `rounds`: what its rounds did. */
export type Idea = { id: string, owner: string, text: string, status: IdeaStatus,
  model?: string, generator: string, by?: string, explore?: Explore, took?: string, timing?: Timing, lookId?: string,
  refine?: RefineAsk, changes?: string[], verdict?: string, undone?: true, error?: string | null, createdAt: string,
  rounds?: IdeaRound[],
  updatedAt: string };
export type LookCreate = z.input<typeof LookCreate>;
export type LookPatch = z.input<typeof LookPatch>;
/** A look as lists show it: what a card needs, no layers or code. */
export type Listed = { id: string, owner: string, ownerName: string, title: string, summary: string, duration: number,
  layerCount: number, shared: boolean, reviewed: boolean, bpm?: number, sharedAt?: string, ideaId?: string,
  preview?: string, createdAt: string, updatedAt: string };
/** A look as GET /api/looks/:id answers. */
export type Look = Omit<Listed, 'layerCount'> & { layers: Layer[], globals?: z.infer<typeof Globals>,
  automation?: Automation, versionCount: number, bake?: Bake | null, reviewedBy?: string,
  flashOverride?: FlashOverride, chain?: 2 };

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
