// The HTTP API's request bodies and what it answers with (SPEC "HTTP API"): accounts, ideas and looks. Bodies are
// parsed with these on the server; the browser takes the types (`import type`).
import { z } from 'zod';

import { type Automation, Bpm, Duration, Globals, type Layer, Layers, LookTitle, Summary } from './look.ts';

/** A body's `chain`: 2 when its chains follow the one rule; without it they are converted (SPEC "Looks"). */
const Chain = z.literal(2, { error: 'chain must be 2 (warps bend what is above them).' }).optional();

const bool = (name: string) => z.boolean({ error: `${name} must be true or false.` });
const USERNAME = 'Username must be 3–32 characters: letters, digits, _ or -.';
export const MAX_PASSWORD = 1024;

/** A username as stored: lower case, 3–32 of [a-z0-9_-]. */
export const Username = z.string({ error: USERNAME }).trim().toLowerCase()
  .regex(/^[a-z0-9_-]{3,32}$/, { error: USERNAME });
export const Signup = z.object({
  username: Username,
  password: z.string({ error: 'Password must be at least 8 characters.' })
    .min(8, { error: 'Password must be at least 8 characters.' })
    .max(MAX_PASSWORD, { error: `Password must be at most ${MAX_PASSWORD} characters.` }),
});
/** A login never says which part was wrong: a malformed name or password is just a wrong one. */
export const Login = z.object({
  username: Username.nullable().catch(null), password: z.string().max(MAX_PASSWORD).catch(''),
}).catch({ username: null, password: '' });

export const IdeaBody = z.object({
  text: z.string({ error: 'Describe the idea in 3–2000 characters.' }).trim()
    .min(3, { error: 'Describe the idea in 3–2000 characters.' })
    .max(2000, { error: 'Describe the idea in 3–2000 characters.' }),
  /** A model id (shared/schemas/models.ts); none: the registry's default. */
  model: z.string({ error: 'model must name one of the models.' })
    .max(32, { error: 'model must name one of the models.' }).optional(),
});

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
/** Where a generation's time went, in ms: in the queue, building the prompt, the model's request, parsing. */
export type Timing = { wait: number, prompt: number, request: number, parse: number, total: number };
/** `model`: the model asked for; `generator`: the one that made the look (a fallback's, if it took over); `by`: its
 * label as shown ("by <label>"). */
export type Idea = { id: string, owner: string, text: string, status: 'queued' | 'generating' | 'ready' | 'failed',
  model?: string, generator: string, by?: string, timing?: Timing, lookId?: string, error?: string | null,
  createdAt: string, updatedAt: string };
export type LookCreate = z.input<typeof LookCreate>;
export type LookPatch = z.input<typeof LookPatch>;
/** A look as lists show it: what a card needs, no layers or code. */
export type Listed = { id: string, owner: string, ownerName: string, title: string, summary: string, duration: number,
  layerCount: number, shared: boolean, reviewed: boolean, bpm?: number, sharedAt?: string, ideaId?: string,
  createdAt: string, updatedAt: string };
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
