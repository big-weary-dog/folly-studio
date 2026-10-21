// The model registry: <data>/models.json (STUDIO_MODELS names another file), written with the defaults on first run,
// checked by shared/schemas/models.ts and read again whenever the file changes, so an admin's edit (by hand or in the
// Models panel) applies without a restart. A file that does not parse is reported and the last good one kept. Each
// model is reached through a transport; one whose prerequisites are missing (no API key, no codex on PATH, the
// foundry off) shows as unavailable and is refused when an idea asks for it, instead of failing later.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  type AdminModels, EFFORTS, isPaid, type ModelChoices, type ModelEntry, type ModelsConfig, offeredTo, readModels,
  type Role, TRANSPORT_CAPS, type Transport, TRANSPORTS,
} from '../../shared/schemas/models.ts';
import { LIMITS } from '../../shared/schemas/access.ts';
import { type Config, configOf } from '../config.ts';
import type { Logger } from '../http.ts';
import { ADAPTERS, type Availability } from './adapters.ts';

export const DEFAULT_MODELS: ModelsConfig = {
  about: 'The models people can pick for their ideas (docs/HOSTING.md). Saved changes apply without a restart.',
  default: 'opus',
  models: [
    { id: 'opus', label: 'Opus', via: 'claude', model: 'claude-opus-5-5', effort: 'medium', enabled: true },
    { id: 'sol', label: 'Sol', via: 'codex', model: 'gpt-6.1-sol', effort: 'low', critique: 'images',
      enabled: true },
    { id: 'luna', label: 'Luna', via: 'codex', model: 'gpt-6-luna', effort: 'low', critique: 'text',
      enabled: true },
  ],
  concurrency: { claude: 4, codex: 2 },
  limits: { ...LIMITS },
};
// STUDIO_GENERATOR, from before the registry: the default it names when the file is first written.
const FOUNDRY: ModelEntry = { id: 'foundry', label: 'Foundry', via: 'fleet', model: 'gpt-6.1-sol', enabled: true };
const LEGACY: Record<string, string> = { claude: 'opus', fleet: 'foundry' };
const PROBE_MS = 10_000;

/** The file's models but those whose `via` is no longer a transport (their ids), so a file written before one was
 * removed still reads (its default, if one of them, the first left); a save is checked whole. */
function dropGone(json: unknown): { json: unknown, gone: string[] } {
  const c = json as { default?: unknown, models?: { id?: unknown, via?: unknown }[] } | null;
  if (!Array.isArray(c?.models)) return { json, gone: [] };
  const vias: readonly string[] = TRANSPORTS;
  const out = c.models.filter((m) => typeof m?.via === 'string' && !vias.includes(m.via)), gone = out.map((m) => m.id);
  const models = c.models.filter((m) => !out.includes(m));
  return { json: { ...c, models, ...(gone.includes(c.default) ? { default: models[0]?.id } : {}) },
    gone: gone.map(String) };
}

type Options = { file: string, env?: NodeJS.ProcessEnv, log?: Logger, legacy?: string, foundryOn?: boolean,
  codexBin?: string, settings?: Config };

/** The registry: the file's models, what each user may pick, and whether each can run here. */
export function createRegistry({ file, env = process.env, log = console, legacy = '', foundryOn = false,
  settings = configOf(env), codexBin = settings.STUDIO_CODEX_BIN || 'codex' }: Options) {
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
    const { json: known, gone } = dropGone(json);
    if (gone.length) log.warn?.(`[models] ${file}: left out ${gone.join(', ')}, whose transport is gone`);
    const read = json === undefined ? null : readModels(known);
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
    const found = ADAPTERS[m.via].probe({ env, codexBin, foundryOn });
    probes.set(m.via, { found, at: Date.now() });
    return found;
  }

  const allowed = offeredTo;
  const usable = (m: ModelEntry, role: Role) => m.enabled && allowed(m, role) && status(m).available;
  /** What `role` may pick, and the one the form starts on: the default, else the first; for someone who may not use
   * the paid models (`paid: false`, a locked account), the first free one. */
  function choices(role: Role, { paid = true } = {}): ModelChoices {
    const c = current(), models = c.models.filter((m) => usable(m, role)).map((m) => ({ id: m.id,
      label: m.label, paid: isPaid(m), ...(TRANSPORT_CAPS[m.via].explores ? { explores: true as const } : {}) }));
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
