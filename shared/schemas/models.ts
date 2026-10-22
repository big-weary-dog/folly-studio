// The model registry (SPEC "Models"): which models people may pick for their ideas, how each is reached, and who may
// use it. It lives in a JSON file an admin edits (src/generate/models.ts reads it); the admin API takes the same shape.
import { z } from 'zod';

import { GlobalLimits, PersonLimits } from './access.ts';

/** How a model is reached: the Messages API, the Codex CLI, or the Fleet foundry. */
export const TRANSPORTS = ['claude', 'codex', 'fleet'] as const;
export type Transport = typeof TRANSPORTS[number];
export const ROLES = ['member', 'curator', 'admin'] as const;
export type Role = typeof ROLES[number];
/** The effort levels each transport takes (Claude: output_config.effort; Codex: model_reasoning_effort). */
export const EFFORTS: Record<Transport, readonly string[]> = { claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh'], fleet: [] };
/** What a transport can do. `prompted`: it reads the guide and composes in rounds (docs, render check, critique);
 * `explores`: it takes an idea's explore level (SPEC-generators "Explore"); `refines`: it may refine a look;
 * `critiques`: it may look at a look's frames; `paid`: it spends money or capacity, so it needs an unlocked account;
 * `needsModel`: its entry must name the provider's model; `defaultEffort`: the effort of a model that names none;
 * `laneDefault`: its jobs at once where neither the registry nor STUDIO_GENERATOR_CONCURRENCY says; `laneMax`: never
 * more than this (the foundry runs one job at a time). */
type TransportCaps = { prompted: boolean, explores: boolean, refines: boolean, critiques: boolean,
  paid: boolean, needsModel: boolean, defaultEffort?: string, laneDefault: number, laneMax?: number };
export const TRANSPORT_CAPS: Record<Transport, TransportCaps> = {
  claude: { prompted: true, explores: true, refines: true, critiques: true, paid: true, needsModel: false,
    defaultEffort: 'medium', laneDefault: 4 },
  codex: { prompted: true, explores: true, refines: true, critiques: true, paid: true, needsModel: true,
    defaultEffort: 'low', laneDefault: 2 },
  fleet: { prompted: false, explores: false, refines: false, critiques: false, paid: true, needsModel: false,
    laneDefault: 1, laneMax: 1 },
};
/** A transport's row; none for a name that is no transport (a test's stand-in adapter). */
export const capsOf = (via: string): TransportCaps | undefined => TRANSPORT_CAPS[via as Transport];
/** Why a model may not do what an idea asks (refine a look, look at its frames), in words; null when it may. The API
 * answers with it before an idea is made, and the queue refuses with it. */
export function cannot(m: { via: string, label: string }, ask: { refine?: boolean, critique?: boolean }) {
  const caps = capsOf(m.via);
  if (ask.refine && !caps?.refines) return `${m.label} cannot refine a look`;
  if (ask.critique && !caps?.critiques) return `${m.label} cannot look at its frames`;
  return null;
}

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
// A provider's model string goes into a request body or an argument list: no spaces, never a leading dash.
const PROVIDER = /^[A-Za-z0-9][\w.:/-]{0,99}$/;
const int = (name: string, lo: number, hi: number) => z.int({ error: `${name} must be a whole number.` })
  .min(lo, { error: `${name} must be at least ${lo}.` }).max(hi, { error: `${name} must be at most ${hi}.` });
const ModelId = z.string({ error: 'id must be text.' })
  .regex(ID, { error: 'id must be 1–32 characters: lower-case letters, digits or -.' });

export const ModelEntry = z.strictObject({
  id: ModelId,
  label: z.string({ error: 'label must be text.' }).trim().min(1, { error: 'label must not be empty.' })
    .max(40, { error: 'label must be at most 40 characters.' }),
  via: z.enum(TRANSPORTS, { error: `via must be one of ${TRANSPORTS.join(', ')}.` }),
  model: z.string({ error: 'model must be text.' })
    .regex(PROVIDER, { error: 'model must be a model name: letters, digits, . _ : / or -.' }).optional(),
  effort: z.string({ error: 'effort must be text.' }).optional(),
  maxTokens: int('maxTokens', 1024, 128_000).optional(),
  timeoutSeconds: int('timeoutSeconds', 10, 3600).optional(),
  /** A critique round after the render check (SPEC-generators "Critique"): stills and text, or text alone. */
  critique: z.enum(['images', 'text'], { error: 'critique must be images or text.' }).optional(),
  enabled: z.boolean({ error: 'enabled must be true or false.' }).default(true),
  roles: z.array(z.enum(ROLES, { error: `roles must be from ${ROLES.join(', ')}.` })).min(1).optional(),
  /** Caps counted on this model's ideas alone (SPEC-access "Access"). */
  limits: PersonLimits.optional(),
});
export type ModelEntry = z.output<typeof ModelEntry>;

const Lanes = z.strictObject(Object.fromEntries(TRANSPORTS.map((t) => [t, int(`concurrency.${t}`, 1, 16)
  .optional()])) as Record<Transport, z.ZodOptional<z.ZodInt>>);

export const ModelsConfig = z.strictObject({
  about: z.string().max(400).optional(),
  default: ModelId,
  models: z.array(ModelEntry).min(1, { error: 'models must list at least one model.' })
    .max(24, { error: 'models may list at most 24 models.' }),
  /** Jobs run at once per transport, so a slow call on one never holds up another. */
  concurrency: Lanes.optional(),
  /** Who may use the paid models, and how much (SPEC-access "Access"); none: the defaults. */
  limits: GlobalLimits.optional(),
}).superRefine((c, ctx) => {
  const seen = new Set<string>();
  c.models.forEach((m, i) => {
    const at = (message: string) => ctx.addIssue({ code: 'custom', path: ['models', i], message });
    if (seen.has(m.id)) at(`id ${m.id} is used twice.`);
    seen.add(m.id);
    if (m.effort !== undefined && !EFFORTS[m.via].includes(m.effort)) {
      at(EFFORTS[m.via].length ? `effort must be one of ${EFFORTS[m.via].join(', ')} for ${m.via}.`
        : `${m.via} takes no effort.`);
    }
    if (TRANSPORT_CAPS[m.via].needsModel && !m.model) at(`a ${m.via} model needs its model name.`);
    if (m.critique && !TRANSPORT_CAPS[m.via].critiques) at(`${m.via} takes no critique.`);
  });
  if (!seen.has(c.default)) ctx.addIssue({ code: 'custom', path: ['default'], message: 'default must name a model.' });
});
export type ModelsConfig = z.output<typeof ModelsConfig>;

/** A registry file's contents, or the first problem with them, in words. */
export function readModels(json: unknown): { config: ModelsConfig } | { error: string } {
  const r = ModelsConfig.safeParse(json);
  if (r.success) return { config: r.data };
  const { path, message } = r.error.issues[0]!;
  const i = path[0] === 'models' && typeof path[1] === 'number' ? path[1] : -1;
  const id = i >= 0 ? (json as { models: { id?: unknown }[] }).models[i]?.id : undefined;
  return { error: i < 0 ? message : `Model ${i + 1}${typeof id === 'string' ? ` (${id})` : ''}: ${message}` };
}

// What the API answers with. GET /api/models: what this user may pick, and which one the form starts on.
/** `paid` and `explores`: its transport's (TRANSPORT_CAPS). */
export type ModelChoice = { id: string, label: string, paid: boolean, explores?: true };
export const isPaid = (m: { via: Transport }) => TRANSPORT_CAPS[m.via].paid;
/** Whether `role` may pick `m`: its `roles`. */
export const offeredTo = (m: { roles?: readonly Role[] }, role: Role) => !m.roles || m.roles.includes(role);
/** `deep` (while Deep is on): what a Deep idea counts as, and whether it is admins' only. */
export type ModelChoices = { models: ModelChoice[], default: string | null, deep?: { uses: number,
  adminOnly: boolean } };
/** GET /api/admin/models: the file, its contents, whether each model can run here, and each transport's efforts. */
export type ModelState = { id: string, available: boolean, note: string, warn?: boolean };
export type AdminModels = { file: string, config: ModelsConfig, models: ModelState[], efforts: typeof EFFORTS,
  problem?: string };
