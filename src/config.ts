// The server's settings from the environment, every one listed here (docs/HOSTING.md "Every setting" is written from
// SETTINGS by npm run docs:settings). server.ts
// reads them once at start (readConfig): a value that does not parse stops it, naming the variable; a STUDIO_ name it
// does not know is warned of (a typo?); what is set is logged. The parsed Config is passed down; a module given none
// (a test, a tool) parses the environment it was given, quietly (configOf).
// Unset means the module's own default. Durations take a unit (500ms, 90s, 5m, 2h); a bare number is in seconds.
// Sizes take k, m or g (2GB). On/off: 1, true, on, yes or 0, false, off, no.
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
/** A duration in ms; a bare number is in seconds. */
const duration = () => setting((v, ctx) => {
  const m = DURATION.exec(v);
  return m ? Number(m[1]) * MS[(m[2] || 's').toLowerCase()]! : bad(ctx, 'must be a duration (500ms, 90s, 5m, 2h).');
});

/** Every setting, its parser and what it is (npm run docs:settings writes docs/HOSTING.md "Every setting" from it). */
function settings() {
  return {
    PORT: [num({ min: 0, max: 65_535, int: true }), 'the port, default 8780'],
    HOST: [text(), 'the address to listen on, default 127.0.0.1; loopback only'],
    STUDIO_RIG: [oneOf('folly', 'cog'), 'the rig: folly, the Folly\'s playa build (the default), or cog, City of Gods'],
    STUDIO_DATA: [text(), 'the data folder, default data/ in the repo'],
    STUDIO_CURATORS: [text(), 'comma-separated usernames with the curator role'],
    STUDIO_ADMINS: [text(), 'comma-separated usernames with the admin role (admins are curators too)'],
    STUDIO_SECURE_COOKIES: [flag(), 'on: the session cookie is Secure (serve over https)'],
    STUDIO_TRUST_PROXY: [flag(), 'on: one proxy in front (a tunnel) gives the client\'s address and host'],
    STUDIO_FRAMES_BROTLI_QUALITY: [num({ min: 0, max: 11, int: true }), 'baked frames\' brotli quality, default 9'],
    STUDIO_FRAMES_MAX_BYTES: [bytes(), 'baked frames\' disk cap, default 2GB'],
    STUDIO_FLASH_CHECK: [flag(), 'off: flashing blocks and dims nothing (local use only)'],
    STUDIO_FLASH_PER_SECOND: [num(), 'flashes a second allowed, default 3 (out of range: the default)'],
    STUDIO_FLASH_DELTA: [num(), 'a flash\'s swing as a share of full light, default 0.5'],
    STUDIO_FLASH_AREA: [num(), 'the share of the LEDs or lit area that blocks, default 0.25'],
    STUDIO_PREVIEWS: [oneOf('playa', 'front'), 'the gallery previews\' camera, default playa'],
    STUDIO_REPORTS_DAYS: [num({ min: 1, max: 3650, int: true }), 'days a bug report is kept, default 90'],
    GIT_SHA: [text(), 'the build\'s commit, for bug reports (default: the checkout\'s)'],
    STUDIO_BAKE_SECONDS: [num({ min: 0 }), 'the longest render-box bake, default 120'],
    STUDIO_BAKE_TIMEOUT: [duration(), 'a bake\'s wall clock, default scaled to its length'],
    STUDIO_BAKE_CPU: [num({ min: 0 }), 'a bake\'s CPU seconds, default scaled to its length'],
    STUDIO_BAKE_TASKS: [num({ min: 0, int: true }), 'a bake\'s task ceiling, default 256'],
    STUDIO_BAKE_NICE: [num({ int: true }), 'a bake\'s nice level (0–19), default 10'],
    STUDIO_BAKE_MEMORY: [bytes(), 'a bake\'s memory cap, default 1GB'],
    STUDIO_BAKE_MAX_FRAMES: [bytes(), 'the largest baked frames, default room for the longest bake'],
  } as const;
}

/** STUDIO_ names read by the deploy script and the tests, not by the server; and the AI's, which an older env file
 * may still set and the server ignores (spec/http "No AI"). */
const ELSEWHERE = new Set(['STUDIO_REF', 'STUDIO_UNIT', 'STUDIO_ENV_FILE', 'STUDIO_HOST_CHECKED_OUT', 'STUDIO_PW_OUT',
  'STUDIO_BACKUP_DIR', 'STUDIO_BACKUP_KEEP', 'STUDIO_BACKUP_OFFSITE',
  'STUDIO_MODELS', 'STUDIO_GENERATOR', 'STUDIO_GENERATOR_FALLBACK', 'STUDIO_GENERATOR_CONCURRENCY', 'STUDIO_FOUNDRY',
  'STUDIO_FOUNDRY_WAIT', 'STUDIO_CRITIQUE_BUDGET_MS', 'STUDIO_IDEA_LOGS', 'STUDIO_IDEA_LOGS_MAX_BYTES',
  ...['MODEL', 'EFFORT', 'MAX_TOKENS', 'TIMEOUT_MS', 'FALLBACKS'].map((s) => `STUDIO_CLAUDE_${s}`),
  ...['BIN', 'TIMEOUT_MS', 'IDLE_MS', 'WORK', 'SCHEMA', 'USER_CONFIG'].map((s) => `STUDIO_CODEX_${s}`),
  ...['BIN', 'WORK', 'MODEL', 'TIMEOUT', 'POLL', 'DATA', 'TMUX', 'MAX_FRAMES'].map((s) => `STUDIO_FLEET_${s}`)]);
const schemaOf = () => z.object(Object.fromEntries(Object.entries(settings())
  .map(([k, [schema]]) => [k, schema])) as { [K in Name]: ReturnType<typeof settings>[K][0] });

type Name = keyof ReturnType<typeof settings>;
export type Config = z.output<ReturnType<typeof schemaOf>>;
/** Every setting's name and what it is. */
export const SETTINGS = Object.entries(settings()).map(([name, [, about]]) => ({ name, about }));

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
  const r = schemaOf().safeParse(env);
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

/** What is set, as one line for the start-up log. */
export function describeConfig(c: Config) {
  const set = Object.entries(c).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${String(v)}`);
  return set.length ? `${set.join(' ')}; the rest at their defaults` : 'every setting at its default';
}
