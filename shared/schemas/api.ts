// The HTTP API's request bodies and what it answers with (SPEC "HTTP API"): accounts, ideas and looks. Bodies are
// parsed with these on the server; the browser takes the types (`import type`).
import { z } from 'zod';

import { Bpm, Duration, Globals, Layers, LookTitle, Summary } from './look.ts';
import type { Automation, Layer } from './look.ts';

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
});

/** POST /api/looks. `automation` is checked against the look's globals (automationFor). */
export const LookCreate = z.object({
  title: LookTitle, summary: Summary, layers: Layers, duration: Duration.optional(), globals: Globals.optional(),
  automation: z.unknown().optional(), bpm: Bpm.optional(), shared: bool('shared').default(false),
  ideaId: z.string({ error: 'ideaId does not name one of your ideas.' }).nullish(),
});
/** PUT /api/looks/:id: what changes; null clears bpm, globals and automation. */
export const LookPatch = z.object({
  title: LookTitle.optional(), summary: Summary.optional(), shared: bool('shared').optional(),
  bpm: Bpm.optional(), layers: Layers.optional(), duration: Duration.optional(), globals: Globals.optional(),
  automation: z.unknown().optional(), reviewed: bool('reviewed').optional(),
});
export const LooksQuery = z.object({
  scope: z.enum(['mine', 'gallery'], { error: 'scope must be mine or gallery.' }).default('mine'),
  versions: z.string().optional(),
});

export const Role = z.enum(['member', 'curator']);
export const User = z.object({ id: z.string(), username: z.string(), role: Role });
export const IdeaStatus = z.enum(['queued', 'generating', 'ready', 'failed']);
export const Idea = z.object({
  id: z.string(), owner: z.string(), text: z.string(), status: IdeaStatus, generator: z.string(),
  lookId: z.string().optional(), error: z.string().nullish(), createdAt: z.string(), updatedAt: z.string(),
});

export type User = z.infer<typeof User>;
export type Idea = z.infer<typeof Idea>;
export type LookCreate = z.input<typeof LookCreate>;
export type LookPatch = z.input<typeof LookPatch>;
/** A look as lists show it: what a card needs, no layers or code. */
export type Listed = { id: string, owner: string, ownerName: string, title: string, summary: string, duration: number,
  layerCount: number, shared: boolean, reviewed: boolean, bpm?: number, sharedAt?: string, ideaId?: string,
  createdAt: string, updatedAt: string };
/** A look as GET /api/looks/:id answers (`bake`: SPEC "Baked frames"). */
export type Look = Omit<Listed, 'layerCount'> & { layers: Layer[], globals?: z.infer<typeof Globals>,
  automation?: Automation, versionCount: number, bake?: Record<string, unknown>, reviewedBy?: string };
