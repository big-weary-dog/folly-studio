// The server's settings from the environment, every one listed here and in docs/HOSTING.md "Every setting". server.ts
// reads them once at start (readConfig): a value that does not parse stops it, naming the variable; a STUDIO_ name it
// does not know is warned of (a typo?); what is set is logged, secrets only as set. The parsed Config is passed down;
// a module given none (a test, a tool) parses the environment it was given, quietly (configOf).
// Unset means the module's own default. Durations take a unit (500ms, 90s, 5m, 2h); a bare number is in the name's
// unit (ms for a _MS name, else seconds). Sizes take k, m or g (2GB). On/off: 1, true, on, yes or 0, false, off, no.
import { z } from 'zod';

import type { Logger } from './http.ts';

const ON = /^(1|true|on|yes)$/i, OFF = /^(0|false|off|no)$/i;
const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i, BYTES = /^(\d+(?:\.\d+)?)\s*([kmg]?)i?b?$/i;
const MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
const SIZE: Record<string, number> = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };

type Warn = (name: string, message: string) => void;
type Ctx = z.RefinementCtx;
/** A setting: its text trimmed, '' as unset, then `read`'s value, or why it is no value. */
const setting = <T>(read: (v: string, ctx: Ctx) => T | undefined) => z.string().optional()
  .transform((raw, ctx) => { const v = raw?.trim() ?? ''; return v ? read(v, ctx) : undefined; });
const bad = (ctx: Ctx, message: string) => { ctx.addIssue({ code: 'custom', message }); return z.NEVER; };

const text = () => setting((v) => v);
const flag = () => setting((v, ctx) => (ON.test(v) ? true : OFF.test(v) ? false
  : bad(ctx, 'must be on or off (1, true, on, yes; 0, false, off, no).')));
const oneOf = <T extends string>(...words: T[]) => setting((v, ctx) => {
  const w = v.toLowerCase() as T;
  return words.includes(w) ? w : bad(ctx, `must be ${words.join(' or ')}.`);
});
const num = ({ min = -Infinity, max = Infinity, int = false } = {}) => setting((v, ctx) => {
  const n = Number(v);
  if (!Number.isFinite(n) || (int && !Number.isInteger(n))) return bad(ctx, `must be a ${int ? 'whole ' : ''}number.`);
  return n < min || n > max ? bad(ctx, `must be from ${min} to ${max}.`) : n;
});
const bytes = () => setting((v, ctx) => {
  const m = BYTES.exec(v);
  return m ? Math.floor(Number(m[1]) * SIZE[m[2]!.toLowerCase()]!) : bad(ctx, 'must be a size (2GB, 500MB, 1024).');
});
/** A duration in ms; a bare number is in `unit`. A bare _MS value under a second is warned of: seconds were meant? */
const duration = (unit: 'ms' | 's', name: string, warn: Warn) => setting((v, ctx) => {
  const m = DURATION.exec(v);
  if (!m) return bad(ctx, 'must be a duration (500ms, 90s, 5m, 2h).');
  const ms = Number(m[1]) * MS[(m[2] || unit).toLowerCase()]!;
  if (!m[2] && unit === 'ms' && ms < 1000) warn(name, `${name}=${v} is ${v} ms; for seconds, write ${v}s.`);
  return ms;
});

/** Every setting, its parser and what it is (docs/HOSTING.md "Every setting" lists the same). */
function settings(warn: Warn) {
  const d = (unit: 'ms' | 's', name: string) => duration(unit, name, warn);
  return {
    PORT: [num({ min: 0, max: 65_535, int: true }), 'the port, default 8780'],
    HOST: [text(), 'the address to listen on, default 127.0.0.1'],
    STUDIO_DATA: [text(), 'the data folder, default studio/data/'],
    STUDIO_CURATORS: [text(), 'comma-separated usernames with the curator role'],
    STUDIO_ADMINS: [text(), 'comma-separated usernames with the admin role (admins are curators too)'],
    STUDIO_SECURE_COOKIES: [flag(), 'on: the session cookie is Secure (serve over https)'],
    STUDIO_TRUST_PROXY: [flag(), 'on: one proxy in front (a tunnel) gives the client\'s address and host'],
    STUDIO_MODELS: [text(), 'the model registry, default <STUDIO_DATA>/models.json'],
    STUDIO_GENERATOR: [text(), 'superseded by the registry: its default when first written (claude, sketch, fleet)'],
    STUDIO_GENERATOR_FALLBACK: [text(), 'a model or transport foundry ideas go to while it is off or busy'],
    STUDIO_GENERATOR_CONCURRENCY: [num({ min: 0 }), 'jobs at once per lane where the registry says nothing'],
    STUDIO_FOUNDRY: [flag(), 'on: the Fleet foundry runs, one job at a time'],
    STUDIO_FOUNDRY_WAIT: [flag(), 'on: foundry ideas wait while it is busy, even with a fallback'],
    STUDIO_CRITIQUE_BUDGET_MS: [d('ms', 'STUDIO_CRITIQUE_BUDGET_MS'), 'past this, no critique starts; default 90s'],
    STUDIO_IDEA_LOGS: [num({ min: 0, int: true }), 'ideas\' logs kept, default 300; 0: none written'],
    STUDIO_IDEA_LOGS_MAX_BYTES: [bytes(), 'their disk cap, default 500MB'],
    STUDIO_FRAMES_BROTLI_QUALITY: [num({ min: 0, max: 11, int: true }), 'baked frames\' brotli quality, default 9'],
    STUDIO_FRAMES_MAX_BYTES: [bytes(), 'baked frames\' disk cap, default 2GB'],
    STUDIO_FLASH_CHECK: [flag(), 'off: flashing blocks and dims nothing (local use only)'],
    STUDIO_FLASH_PER_SECOND: [num(), 'flashes a second allowed, default 3 (out of range: the default)'],
    STUDIO_FLASH_DELTA: [num(), 'a flash\'s swing as a share of full light, default 0.5'],
    STUDIO_FLASH_AREA: [num(), 'the share of the LEDs or lit area that blocks, default 0.25'],
    STUDIO_LIVE_CONTROL: [oneOf('curators', 'admins', 'members'), 'who drives /live, default curators'],
    STUDIO_LIVE_LOOKS: [oneOf('reviewed', 'shared'), 'what may play on /live, default reviewed'],
    STUDIO_PREVIEWS: [oneOf('playa', 'front'), 'the gallery previews\' camera, default playa'],
    PI_PREVIEW_URL: [text(), 'a dry-run Studio Live on this machine, shown to admins at /pi'],
    GIT_SHA: [text(), 'the build\'s commit, for bug reports (default: the checkout\'s)'],
    STUDIO_BAKE_SECONDS: [num({ min: 0 }), 'the longest render-box bake, default 120'],
    STUDIO_BAKE_TIMEOUT: [d('s', 'STUDIO_BAKE_TIMEOUT'), 'a bake\'s wall clock, default scaled to its length'],
    STUDIO_BAKE_CPU: [num({ min: 0 }), 'a bake\'s CPU seconds, default scaled to its length'],
    STUDIO_BAKE_TASKS: [num({ min: 0, int: true }), 'a bake\'s task ceiling, default 256'],
    STUDIO_BAKE_NICE: [num({ int: true }), 'a bake\'s nice level (0–19), default 10'],
    STUDIO_BAKE_MEMORY: [bytes(), 'a bake\'s memory cap, default 1GB'],
    STUDIO_BAKE_MAX_FRAMES: [bytes(), 'the largest baked frames, default room for the longest bake'],
    ANTHROPIC_API_KEY: [text(), 'the Messages API key (Opus); a secret'],
    ANTHROPIC_BASE_URL: [text(), 'the Messages API, default https://api.anthropic.com'],
    STUDIO_CLAUDE_MODEL: [text(), 'a claude model\'s name where its entry names none'],
    STUDIO_CLAUDE_EFFORT: [text(), 'a claude model\'s effort where its entry names none, default medium'],
    STUDIO_CLAUDE_MAX_TOKENS: [num({ min: 1, int: true }), 'a claude answer\'s tokens, thinking too; default 32000'],
    STUDIO_CLAUDE_TIMEOUT_MS: [d('ms', 'STUDIO_CLAUDE_TIMEOUT_MS'), 'a claude call\'s attempt, default 300s'],
    STUDIO_CLAUDE_FALLBACKS: [flag(), 'off: no server-side refusal fallback'],
    STUDIO_CODEX_BIN: [text(), 'the Codex CLI, default codex on PATH'],
    STUDIO_CODEX_TIMEOUT_MS: [d('ms', 'STUDIO_CODEX_TIMEOUT_MS'), 'a codex call\'s wall clock, default 300s'],
    STUDIO_CODEX_IDLE_MS: [d('ms', 'STUDIO_CODEX_IDLE_MS'), 'a codex call silent this long has stalled; default 180s'],
    STUDIO_CODEX_WORK: [text(), 'codex\'s empty work folder, default in the system\'s temp folder'],
    STUDIO_CODEX_SCHEMA: [flag(), 'off: no --output-schema'],
    STUDIO_CODEX_USER_CONFIG: [flag(), 'on: codex reads ~/.codex/config.toml'],
    STUDIO_FLEET_BIN: [text(), 'the fleet command, default fleet'],
    STUDIO_FLEET_WORK: [text(), 'the foundry\'s workspaces, default ~/.folly-studio/fleet'],
    STUDIO_FLEET_MODEL: [text(), 'the foundry\'s model where its entry names none, default gpt-6.1-sol'],
    STUDIO_FLEET_TIMEOUT: [d('s', 'STUDIO_FLEET_TIMEOUT'), 'a foundry job\'s wall clock, default 30m'],
    STUDIO_FLEET_POLL: [d('s', 'STUDIO_FLEET_POLL'), 'how often a foundry job is looked at, default 5s'],
    STUDIO_FLEET_DATA: [text(), 'fleet\'s state folder, default ~/.fleet'],
    STUDIO_FLEET_TMUX: [text(), 'the tmux command, default tmux'],
    STUDIO_FLEET_MAX_FRAMES: [bytes(), 'the largest frames a foundry job may leave, default room for 120 s'],
  } as const;
}

/** STUDIO_ names read by the deploy script and the tests, not by the server. */
const ELSEWHERE = new Set(['STUDIO_REF', 'STUDIO_UNIT', 'STUDIO_ENV_FILE', 'STUDIO_HOST_CHECKED_OUT', 'STUDIO_PW_OUT']);
const SECRET = new Set(['ANTHROPIC_API_KEY']);
const schemaOf = (warn: Warn) => z.object(Object.fromEntries(Object.entries(settings(warn))
  .map(([k, [schema]]) => [k, schema])) as { [K in Name]: ReturnType<typeof settings>[K][0] });

type Name = keyof ReturnType<typeof settings>;
export type Config = z.output<ReturnType<typeof schemaOf>>;
/** Every setting's name and what it is. */
export const SETTINGS = Object.entries(settings(() => {})).map(([name, [, about]]) => ({ name, about }));

/** The bad settings: `names` and, one a line, each name and what is wrong (never its value). */
export class ConfigError extends Error {
  names: string[];
  constructor(issues: { name: string, message: string }[]) {
    super(issues.map((i) => `${i.name} ${i.message}`).join('\n'));
    this.names = issues.map((i) => i.name);
  }
}

/** The settings in `env`, or a ConfigError naming every bad one; unknown STUDIO_ names and odd values warned of
 * (`warned` gets each one's name). */
export function readConfig(env: NodeJS.ProcessEnv, { log, warned }: { log?: Logger, warned?: string[] } = {}): Config {
  const warn: Warn = (name, message) => { warned?.push(name); log?.warn?.(`[config] ${message}`); };
  const r = schemaOf(warn).safeParse(env);
  if (!r.success) throw new ConfigError(r.error.issues.map((i) => ({ name: i.path.join('.'), message: i.message })));
  for (const name of Object.keys(env)) {
    if (name.startsWith('STUDIO_') && !(name in r.data) && !ELSEWHERE.has(name)) {
      warn(name, `${name} is not a setting the server reads (docs/HOSTING.md "Environment"); a typo?`);
    }
  }
  return r.data;
}

const parsed = new WeakMap<object, Config>();
/** The settings in `env` for a module given no Config, parsed once per environment and quietly. */
export function configOf(env: NodeJS.ProcessEnv = process.env): Config {
  let c = parsed.get(env);
  if (!c) parsed.set(env, c = readConfig(env));
  return c;
}

/** What is set, as one line for the start-up log: secrets only as set. */
export function describeConfig(c: Config) {
  const set = Object.entries(c).filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${SECRET.has(k) ? '(set)' : String(v)}`);
  return set.length ? `${set.join(' ')}; the rest at their defaults` : 'every setting at its default';
}
