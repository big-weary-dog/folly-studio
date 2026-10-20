// The model registry: <data>/models.json (STUDIO_MODELS names another file), written with the defaults on first run,
// checked by shared/schemas/models.ts and read again whenever the file changes, so an admin's edit (by hand or in the
// Models panel) applies without a restart. A file that does not parse is reported and the last good one kept. Each
// model is reached through a transport; one whose prerequisites are missing (no API key, no codex on PATH, the
// foundry off) shows as unavailable and is refused when an idea asks for it, instead of failing later.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  type AdminModels, EFFORTS, isPaid, type ModelChoices, type ModelEntry, type ModelsConfig, readModels, type Role,
  type Transport,
} from '../../shared/schemas/models.ts';
import { LIMITS } from '../../shared/schemas/access.ts';
import type { Logger } from '../http.ts';
import { findExecutable } from './proc.ts';

export const DEFAULT_MODELS: ModelsConfig = {
  about: 'The models people can pick for their ideas (docs/HOSTING.md). Saved changes apply without a restart.',
  default: 'opus',
  models: [
    { id: 'opus', label: 'Opus', via: 'claude', model: 'claude-opus-5-5', effort: 'medium', enabled: true },
    { id: 'sol', label: 'Sol', via: 'codex', model: 'gpt-6.1-sol', effort: 'low', critique: 'images',
      enabled: true },
    { id: 'luna', label: 'Luna', via: 'codex', model: 'gpt-6-luna', effort: 'low', critique: 'text',
      enabled: true },
    { id: 'sketch', label: 'Sketch', via: 'sketch', enabled: true, limits: { perHour: 30, perDay: 100 } },
  ],
  concurrency: { claude: 4, codex: 2 },
  limits: { ...LIMITS },
};
// STUDIO_GENERATOR, from before the registry: the default it names when the file is first written.
const FOUNDRY: ModelEntry = { id: 'foundry', label: 'Foundry', via: 'fleet', model: 'gpt-6.1-sol', enabled: true };
const LEGACY: Record<string, string> = { claude: 'opus', sketch: 'sketch', fleet: 'foundry' };
const PROBE_MS = 10_000;

/** `warn`: it may run, but something looks missing (no Codex login seen). */
export type Availability = { available: boolean, note: string, warn?: boolean };
type Options = { file: string, env?: NodeJS.ProcessEnv, log?: Logger, legacy?: string, foundryOn?: boolean,
  codexBin?: string };

/** The registry: the file's models, what each user may pick, and whether each can run here. */
export function createRegistry({ file, env = process.env, log = console, legacy = '', foundryOn = false,
  codexBin = env.STUDIO_CODEX_BIN || 'codex' }: Options) {
  let sig = '', config = DEFAULT_MODELS, problem = '';
  const probes = new Map<string, { found: Availability, at: number }>();
  const signature = () => {
    try { const st = statSync(file); return `${st.size}:${st.mtimeMs}`; } catch { return '-'; }
  };

  function write(next: ModelsConfig) {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, file);
    [sig, config, problem] = [signature(), next, ''];
  }

  /** The file as it is now: re-read when its size or time changed; a bad one keeps the last good. */
  function current() {
    const s = signature();
    if (s === sig) return config;
    sig = s;
    let json: unknown;
    try { json = JSON.parse(readFileSync(file, 'utf8')); } catch (err) {
      problem = `${path.basename(file)} is not valid JSON (${(err as Error).message}).`;
    }
    const read = json === undefined ? null : readModels(json);
    if (read && 'config' in read) [config, problem] = [read.config, ''];
    else if (read) problem = `${path.basename(file)}: ${read.error}`;
    if (problem) log.warn?.(`[models] ${problem} Using the last good models.`);
    else log.info?.(`[models] ${config.models.length} models from ${file} (default ${config.default})`);
    return config;
  }

  if (!existsSync(file)) {
    const wanted = LEGACY[legacy.trim().toLowerCase()];
    const models = wanted === 'foundry' ? [...DEFAULT_MODELS.models, FOUNDRY] : DEFAULT_MODELS.models;
    try { write({ ...DEFAULT_MODELS, models, default: wanted || DEFAULT_MODELS.default }); } catch (err) {
      log.warn?.(`[models] could not write ${file}: ${(err as Error).message}; using the defaults`);
    }
  } else if (legacy) log.info?.(`[models] STUDIO_GENERATOR is superseded by ${file}`);
  current();

  /** Whether a model can run here: its transport's prerequisites, checked at most every 10 s. */
  function status(m: ModelEntry): Availability {
    const seen = probes.get(m.via);
    if (seen && Date.now() - seen.at < PROBE_MS) return seen.found;
    const found = probe(m.via);
    probes.set(m.via, { found, at: Date.now() });
    return found;
  }
  function probe(via: Transport): Availability {
    if (via === 'sketch') return { available: true, note: 'Offline; always there.' };
    if (via === 'claude') {
      return env.ANTHROPIC_API_KEY ? { available: true, note: 'Anthropic API key set.' }
        : { available: false, note: 'ANTHROPIC_API_KEY is not set.' };
    }
    if (via === 'fleet') {
      return foundryOn ? { available: true, note: 'The Fleet foundry is on: one idea at a time.' }
        : { available: false, note: 'The Fleet foundry is off (STUDIO_FOUNDRY=on).' };
    }
    if (!findExecutable(codexBin, { env })) return { available: false, note: `${codexBin} is not on PATH.` };
    const home = env.CODEX_HOME || path.join(homedir(), '.codex');
    return existsSync(path.join(home, 'auth.json')) || env.CODEX_API_KEY
      ? { available: true, note: 'Codex CLI found, signed in.' }
      : { available: true, warn: true, note: 'Codex CLI found; no login seen (run codex login).' };
  }

  const allowed = (m: ModelEntry, role: Role) => !m.roles || m.roles.includes(role);
  const usable = (m: ModelEntry, role: Role) => m.enabled && allowed(m, role) && status(m).available;
  /** What `role` may pick, and the one the form starts on: the default, else the first; for someone who may not use
   * the paid models (`paid: false`, a locked account), the first free one. */
  function choices(role: Role, { paid = true } = {}): ModelChoices {
    const c = current(), models = c.models.filter((m) => usable(m, role)).map((m) => ({ id: m.id,
      label: m.label, paid: isPaid(m) }));
    const open = paid ? models : models.filter((m) => !m.paid);
    return { models, default: open.find((m) => m.id === c.default)?.id ?? open[0]?.id ?? models.find((m) =>
      m.id === c.default)?.id ?? models[0]?.id ?? null };
  }
  function admin(): AdminModels {
    const c = current();
    return { file, config: c, models: c.models.map((m) => ({ id: m.id, ...status(m) })), efforts: EFFORTS,
      ...(problem ? { problem } : {}) };
  }

  return {
    file,
    config: current,
    get: (id: string) => current().models.find((m) => m.id === id),
    defaultId: () => current().default,
    /** Jobs at once for a transport, when the file says. */
    limit: (via: string) => current().concurrency?.[via as Transport],
    status, choices, admin,
    /** The model an idea asked for (none: the default this user gets), or why it may not have it. */
    pick(id: string | undefined, role: Role, o: { paid?: boolean } = {}): { entry: ModelEntry } | { error: string } {
      const want = id ?? choices(role, o).default;
      const m = want ? current().models.find((x) => x.id === want) : undefined;
      if (!m) return { error: want ? `There is no model called "${want}".` : 'No model is available right now.' };
      if (!m.enabled) return { error: `${m.label} is turned off.` };
      if (!allowed(m, role)) return { error: `${m.label} is not offered to your account.` };
      if (!status(m).available) return { error: `${m.label} is not set up on this server right now.` };
      return { entry: m };
    },
    /** Write a new registry (the admin API's); refused with the first problem when it is not one. */
    save(json: unknown): { error: string } | AdminModels {
      const read = readModels(json);
      if ('error' in read) return read;
      write(read.config);
      log.info?.(`[models] saved ${file} (default ${read.config.default})`);
      return admin();
    },
  };
}
export type Registry = ReturnType<typeof createRegistry>;
