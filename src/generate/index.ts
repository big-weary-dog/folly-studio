// The idea → look queue, in-process. Each idea names a model of the registry (models.ts); its job waits in its
// model's transport lane (claude, codex, sketch, fleet), each lane with its own concurrency, so a slow call on one
// never holds up another. A job: idea 'generating', the adapter turns the text into a look, validateLook
// (shared/schemas/generated.ts) cleans it, the look is saved and the idea 'ready' with where the time went, or
// 'failed' with a user-safe error. The fallback (STUDIO_GENERATOR_FALLBACK) takes over when a model fails.
// An adapter may also return `bake` (a checkFrames record, kept on the look) and `frames` (stored).
// The Fleet foundry (via fleet) is opt-in, STUDIO_FOUNDRY=on, one job at a time. While it is off or busy, its ideas
// go to the one-shot generator (STUDIO_GENERATOR_FALLBACK, else sketch), or wait for it with STUDIO_FOUNDRY_WAIT=1.
// An idea that names no model (from before the registry) goes to STUDIO_GENERATOR's transport.

import path from 'node:path';

import { CHAIN } from '../../shared/chain-order.ts';
import type { Bake, Idea } from '../../shared/schemas/api.ts';
import { GenerateError, validateLook } from '../../shared/schemas/generated.ts';
import type { ModelEntry } from '../../shared/schemas/models.ts';
import type { LibraryEntry, Rig, RigGroup } from '../../shared/schemas/rig.ts';
import { layersHash, renderFields, saveFrames } from '../bake.ts';
import type { Catalog } from './catalog.ts';
import { createClaudeAdapter } from './claude.ts';
import { createCodexAdapter } from './codex.ts';
import { expand, type ExpandError, type Uses } from './expand.ts';
import { createFleetAdapter, hasMemoryCap } from './fleet.ts';
import type { Registry } from './models.ts';
import { buildPrompt } from './prompt.ts';
import { sketchLook } from './sketch.ts';
import type { Logger } from '../http.ts';
import type { Store } from '../store.ts';

export { GenerateError, validateLook };

const FALLBACK_ERROR = 'Something went wrong while turning this idea into a look.';
/** The guide, the output schema and the catalog: built once per library and rig, the same bytes on every call (so it
 * caches). */
export type Prompt = { system: string, schema: Record<string, unknown>, catalog: Catalog };
/** A repair turn: the model's previous answer and what expanding it found wrong. */
export type Repair = { answer: unknown, errors: ExpandError[] };
/** What an adapter is given (SPEC "Generators"), and what makes a look of it: raw output, cleaned by validateLook. */
export type Context = { text: string, user: { id: string, username?: string, role?: string },
  library: LibraryEntry[], rig: Rig | null, groups: RigGroup[], idea?: { id: string }, prompt?: () => Prompt,
  repair?: Repair, signal?: AbortSignal };
export type Adapter = { name?: string, generate(ctx: Context): unknown };
type Route = { id: string, label: string, via: string, entry?: ModelEntry };
type Job = { id: string, route: Route, queuedAt: number };
const LABELS: Record<string, string> = { sketch: 'Sketch', claude: 'Claude', codex: 'Codex', fleet: 'Fleet' };
const PROMPTED = new Set(['claude', 'codex']);
const LANE_DEFAULTS: Record<string, number> = { claude: 4, codex: 2, sketch: 4 };
const REPAIR_ROUNDS = 1; // inside the one idea: a repair is not another use
const NO_USES: Uses = { library: 0, extensions: 0, code: 0 };

/** What a look was made of, for the log: `3 library, 1 extension`. */
const describeUses = (u: Uses) => (u === NO_USES ? 'not composed'
  : [`${u.library} library`, u.extensions && `${u.extensions} extension`, u.code && `${u.code} code`]
    .filter(Boolean).join(', '));
/** The first few notes of what was dropped or mended, cut short: the log stays one line. */
const dropped = (notes: string[]) => (notes.length ? `; ${notes.length} noted: ${notes.slice(0, 3).join('; ')}`
  .slice(0, 240) : '');

/** A transport's adapter for one model: its model string, effort and limits from the registry. */
function makeAdapter(via: string, m: ModelEntry | undefined, log: Logger, codexBin?: string): Adapter {
  const timeoutMs = m?.timeoutSeconds ? m.timeoutSeconds * 1000 : undefined;
  if (via === 'claude') {
    return createClaudeAdapter({ log, model: m?.model, effort: m?.effort, maxTokens: m?.maxTokens, timeoutMs });
  }
  if (via === 'codex') return createCodexAdapter({ log, model: m?.model, effort: m?.effort, timeoutMs, bin: codexBin });
  if (via === 'fleet') return createFleetAdapter({ log, model: m?.model, timeoutMs });
  return { name: 'sketch', generate: async (ctx: Context) => sketchLook(ctx) };
}

/** The foundry's settings from the environment: { on, wait, memoryCap() → Promise<boolean> }. */
export function foundryFromEnv(env = process.env) {
  const yes = (v?: string) => /^(on|1|true)$/i.test(v || '');
  return { on: yes(env.STUDIO_FOUNDRY), wait: yes(env.STUDIO_FOUNDRY_WAIT), memoryCap: () => hasMemoryCap() };
}

/**
 * The queue: enqueue(idea | id) → false when already queued; idle(), stop(), size, watch(id, fn). models: the
 * registry (an idea's `model` picks the route); adapterName: STUDIO_GENERATOR, the route of an idea that names no
 * model; adapters: transport → { generate } or a function, in place of the built-in ones;
 * concurrency: STUDIO_GENERATOR_CONCURRENCY, per lane where the registry says nothing; fallbackName:
 * STUDIO_GENERATOR_FALLBACK, a model or transport tried when one fails (and the foundry's one-shot generator);
 * loadVersion: changes when the library or rig does (the prompt is built again only then).
 */
export function createQueue({
  store, loadLibrary = () => [], loadRig = () => null, loadVersion, models, adapterName = process.env.STUDIO_GENERATOR
    || 'sketch', log = console, adapters = {}, concurrency = Number(process.env.STUDIO_GENERATOR_CONCURRENCY) || 0,
  fallbackName = process.env.STUDIO_GENERATOR_FALLBACK || '', framesDir, foundry = foundryFromEnv(), codexBin,
}: { store: Pick<Store, 'ideas' | 'looks'> & Partial<Store>, loadLibrary?: () => LibraryEntry[],
  loadRig?: () => Rig | null | Promise<Rig | null>, loadVersion?: () => string, models?: Registry,
  adapterName?: string, log?: Logger, adapters?: Record<string, Adapter | Adapter['generate']>, concurrency?: number,
  fallbackName?: string, framesDir?: string, foundry?: Partial<ReturnType<typeof foundryFromEnv>>,
  codexBin?: string }) {
  const framesHome = framesDir ?? (store.dataDir ? path.join(store.dataDir, 'frames') : '');
  const transports = new Set(['sketch', 'claude', 'codex', 'fleet', ...Object.keys(adapters)]);
  const made = new Map<string, Adapter>();
  function adapterFor(r: Route): Adapter {
    const given = adapters[r.via];
    if (given) return typeof given === 'function' ? { generate: given } : given;
    const key = JSON.stringify([r.via, r.entry ?? null]);
    if (!made.has(key)) made.set(key, makeAdapter(r.via, r.entry, log, codexBin));
    return made.get(key)!;
  }
  /** A model of the registry, else a transport by name; null when neither. */
  function route(name: string): Route | null {
    const entry = models?.get(name);
    if (entry) return { id: entry.id, label: entry.label, via: entry.via, entry };
    return transports.has(name) ? { id: name, label: LABELS[name] ?? name, via: name } : null;
  }

  // An idea from before the registry names no model: it goes where STUDIO_GENERATOR sent ideas then.
  let primary = String(adapterName || 'sketch').trim().toLowerCase();
  if (!route(primary)) {
    log.error?.(`[generate] unknown generator "${adapterName}"; using sketch`);
    primary = 'sketch';
  }
  const fallback = fallbackName ? route(fallbackName) : null;
  const oneShot = fallback && fallback.via !== 'fleet' ? fallback : route('sketch')!;
  const deep = primary === 'fleet' || !!models?.config().models.some((m) => m.via === 'fleet' && m.enabled);
  const foundryOn = deep && foundry.on === true;
  if (deep && !foundryOn) {
    log.warn?.(`[generate] the Fleet foundry is off (STUDIO_FOUNDRY=on runs it); ideas go to ${oneShot.id}`);
  }
  if (foundryOn) {
    Promise.resolve(foundry.memoryCap?.()).then((capped) => {
      if (capped === false) {
        log.warn?.('[generate] WARNING: no systemd user bus on this host, so Fleet boxes run with NO MEMORY CAP '
          + '(only CPU seconds, a task ceiling and a wall clock). One foundry job can use all of this machine\'s '
          + 'memory: run the foundry on another machine, or watch it.');
      }
    }, () => {});
  }

  const lanes = new Map<string, { running: number, jobs: Job[] }>();
  const lane = (via: string) => lanes.get(via) ?? lanes.set(via, { running: 0, jobs: [] }).get(via)!;
  const limitOf = (via: string) => (via === 'fleet' ? 1
    : models?.limit(via) ?? (concurrency > 0 ? Math.floor(concurrency) : LANE_DEFAULTS[via] ?? 1));
  const active = new Set<string>(); // idea ids queued or running: enqueue is idempotent per id
  const watchers = new Map<string, Set<() => void>>();
  const running = new Set<AbortController>();
  const waiters: (() => void)[] = [];
  let stopping = false;
  const busy = () => [...lanes.values()].some((l) => l.running || l.jobs.length);
  const notify = (id: string) => watchers.get(id)?.forEach((fn) => fn());

  function start(l: { running: number }, job: Job) {
    l.running++;
    runJob(job)
      .catch((err) => log.error?.(`[generate] job ${job.id} crashed: ${err?.stack || err}`))
      .finally(() => {
        l.running--;
        active.delete(job.id);
        pump();
        if (!busy()) waiters.splice(0).forEach((r) => r());
      });
  }

  function pump() {
    const foundryLane = lanes.get('fleet');
    if (foundryLane?.running && foundryLane.jobs.length && !foundry.wait) { // the foundry is busy: one-shot instead
      lane(oneShot.via).jobs.push(...foundryLane.jobs.splice(0).map((j) => ({ ...j, route: oneShot })));
    }
    for (const [via, l] of lanes) while (l.jobs.length && l.running < limitOf(via)) start(l, l.jobs.shift()!);
  }

  // The library, the rig and the prompt, kept while loadVersion() (else the loaders' objects) stay the same.
  let prepared: { version: string, library: LibraryEntry[], rig: Rig | null, groups: RigGroup[], prompt?: Prompt }
    | null = null;
  async function prepare() {
    const version = loadVersion?.() ?? '';
    if (version && prepared?.version === version) return prepared;
    const [library = [], rig = null] = await Promise.all([loadLibrary(), loadRig()]);
    if (!version && prepared && prepared.library === library && prepared.rig === rig) return prepared;
    prepared = { version, library, rig, groups: Array.isArray(rig?.groups) ? rig.groups : [] };
    return prepared;
  }
  const promptOf = (p: NonNullable<typeof prepared>) => (p.prompt ??= buildPrompt(p));

  /** A prompted model's composition, expanded from the library; a repair turn when it named what is not there. */
  async function composed(adapter: Adapter, ctx: Context, catalog: Catalog) {
    let raw = await adapter.generate(ctx), x = expand(raw, catalog), rounds = 0;
    while (x.errors.length && rounds < REPAIR_ROUNDS) {
      if (stopping) break;
      rounds++;
      try {
        raw = await adapter.generate({ ...ctx, repair: { answer: raw, errors: x.errors } });
      } catch (err) { // the answer before, less what it got wrong, still makes a look
        log.warn?.(`[generate] idea ${ctx.idea?.id}: repair failed (${String((err as Error)?.message).slice(0, 160)})`);
        break;
      }
      x = expand(raw, catalog);
    }
    const left = x.errors.map((e) => `${e.path}: ${e.message}`);
    return { raw, look: x.look, notes: [...x.notes, ...left], uses: x.uses, rounds };
  }

  /** The look from the route's adapter, validated; the fallback tries when that one fails. */
  async function lookFrom(ctx: Context, r: Route) {
    const t0 = Date.now();
    const attempt = async (by: Route) => {
      const adapter = adapterFor(by);
      const out = PROMPTED.has(by.via) && ctx.prompt ? await composed(adapter, ctx, ctx.prompt().catalog)
        : { raw: await adapter.generate(ctx), notes: [], uses: NO_USES, rounds: 0 };
      const t1 = Date.now(), look = validateLook('look' in out ? out.look : out.raw, ctx);
      look.dropped.unshift(...out.notes);
      return { ...out, look, used: by, request: t1 - t0, parse: Date.now() - t1, failed: '' };
    };
    try {
      return await attempt(r);
    } catch (err) {
      if (!fallback || fallback.id === r.id || stopping) throw err;
      log.warn?.(`[generate] ${r.id} failed for idea ${ctx.idea?.id} (${(err as Error)?.message}); `
        + `trying ${fallback.id}`);
      const out = await attempt(fallback);
      const why = err instanceof GenerateError ? err.userMessage : 'The AI generator was unavailable.';
      out.look.summary = `${why} ${out.look.summary}`.slice(0, 400);
      return { ...out, failed: `${r.id} failed` };
    }
  }

  const update = async (id: string, patch: Partial<Idea>) => {
    await store.ideas.update(id, patch);
    notify(id);
  };

  async function runJob({ id, route: r, queuedAt }: Job) {
    const idea = await store.ideas.get(id);
    if (!idea) return log.warn?.(`[generate] idea ${id} no longer exists`);
    if (idea.status === 'ready' && idea.lookId) return; // already done (re-enqueued after a restart)
    const started = Date.now(), ac = new AbortController();
    running.add(ac);
    await update(id, { status: 'generating', generator: r.id, by: r.label, error: null });
    try {
      const owner = (await store.users?.get?.(idea.owner)) || null;
      const user = owner ? { id: owner.id, username: owner.username, role: owner.role } : { id: idea.owner };
      const base = await prepare();
      if (PROMPTED.has(r.via)) promptOf(base);
      const prompt = Date.now() - started;
      const ctx: Context = { text: String(idea.text ?? ''), user, library: base.library, rig: base.rig,
        groups: base.groups, idea: { id }, prompt: () => promptOf(base), signal: ac.signal };
      const { raw, look, used, request, parse, uses, rounds, failed } = await lookFrom(ctx, r);
      const { bake: made, frames } = (raw ?? {}) as { bake?: Bake, frames?: unknown };
      const bake = made && typeof made === 'object' ? { ...made, layersHash: layersHash(renderFields(look)) } : null;
      const saved = await store.looks.create({
        owner: idea.owner, ownerName: owner?.username || '', title: look.title, summary: look.summary,
        layers: look.layers,
        ...(look.duration !== undefined ? { duration: look.duration } : {}),
        ...(look.globals ? { globals: look.globals } : {}), ...(look.automation ? { automation: look.automation } : {}),
        shared: false, reviewed: false, ideaId: id, chain: CHAIN, ...(bake ? { bake } : {}),
      });
      if (bake?.frames) await keepFrames(saved.id, frames, bake);
      const timing = { wait: started - queuedAt, prompt, request, parse, total: Date.now() - queuedAt };
      await update(id, { status: 'ready', lookId: saved.id, generator: used.id, by: used.label, error: null, timing });
      log.info?.(`[generate] idea ${id} ready via ${used.id}${failed ? ` after ${failed}` : ''} in ${timing.total} ms `
        + `(queued ${timing.wait}, request ${request}${rounds ? `, ${rounds} repair` : ''}; ${describeUses(uses)}`
        + `${dropped(look.dropped)}; look ${saved.id})`);
    } catch (err) {
      if (stopping) return; // left as it is: the next start queues it again
      log.warn?.(`[generate] idea ${id} failed via ${r.id}: ${(err as Error)?.message || err}`);
      const error = err instanceof GenerateError ? err.userMessage : FALLBACK_ERROR;
      await update(id, { status: 'failed', error });
    } finally {
      running.delete(ac);
    }
  }

  async function keepFrames(lookId: string, bytes: unknown, bake: Bake) {
    try {
      if (!framesHome || !(bytes instanceof Uint8Array)) throw new Error('no frames directory');
      await saveFrames(framesHome, lookId, bytes);
    } catch (err) {
      log.warn?.(`[generate] look ${lookId}: could not store its frames: ${(err as Error)?.message || err}`);
      const reason = 'The baked frames could not be stored.';
      await store.looks.update(lookId, { bake: { ...bake, ok: false, status: 'failed', frames: undefined, reason } });
    }
  }

  return {
    adapterName: deep && !foundryOn && primary === 'fleet' ? oneShot.id : primary, foundry: foundryOn,
    enqueue(idea: { id: string, model?: string } | string) {
      const id = typeof idea === 'object' && idea ? idea.id : idea;
      if (id == null || active.has(id) || stopping) return false;
      const wanted = (typeof idea === 'object' ? idea.model : undefined) ?? store.ideas.get(id)?.model;
      let r = route(wanted || primary);
      if (!r) {
        log.warn?.(`[generate] idea ${id} asks for an unknown model "${wanted}"; using sketch`);
        r = route('sketch')!;
      }
      if (r.via === 'fleet' && !foundryOn) r = oneShot;
      active.add(id);
      lane(r.via).jobs.push({ id, route: r, queuedAt: Date.now() });
      pump();
      return true;
    },
    /** Calls fn whenever the idea's status changes; returns the unsubscribe. */
    watch(id: string, fn: () => void) {
      const set = watchers.get(id) ?? watchers.set(id, new Set()).get(id)!;
      set.add(fn);
      return () => { set.delete(fn); if (!set.size) watchers.delete(id); };
    },
    /** Stop: nothing new starts, and running calls are cut (their ideas are queued again at the next start). */
    stop() {
      stopping = true;
      for (const l of lanes.values()) l.jobs.splice(0).forEach((j) => active.delete(j.id));
      running.forEach((ac) => ac.abort());
      if (!busy()) waiters.splice(0).forEach((r) => r());
    },
    idle: () => (!busy() ? Promise.resolve() : new Promise<void>((r) => waiters.push(r))),
    get size() { return [...lanes.values()].reduce((n, l) => n + l.running + l.jobs.length, 0); },
  };
}
