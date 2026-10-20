// The idea → look queue, in-process. Each idea names a model of the registry (models.ts); its job waits in its
// model's transport lane (claude, codex, sketch, fleet), each lane with its own concurrency, so a slow call on one
// never holds up another. A job: idea 'generating', the adapter turns the text into a look, validateLook
// (shared/schemas/generated.ts) cleans it, the look is saved and the idea 'ready' with where the time went, or
// 'failed' with a user-safe error (the Studio offers "Try again"): no other generator stands in for a failed one.
// An adapter may also return `bake` (a checkFrames record, kept on the look) and `frames` (stored).
// The Fleet foundry (via fleet) is opt-in, STUDIO_FOUNDRY=on, one job at a time. While it is off or busy, its ideas
// go to the one-shot generator (STUDIO_GENERATOR_FALLBACK, else sketch), or wait for it with STUDIO_FOUNDRY_WAIT=1.
// An idea that names no model (from before the registry) goes to STUDIO_GENERATOR's transport.

import path from 'node:path';

import { CHAIN } from '../../shared/chain-order.ts';
import type { Bake, Explore, Idea } from '../../shared/schemas/api.ts';
import { GenerateError, validateLook } from '../../shared/schemas/generated.ts';
import type { ModelEntry, Transport } from '../../shared/schemas/models.ts';
import type { LibraryEntry, Rig, RigGroup } from '../../shared/schemas/rig.ts';
import { layersHash, removeFrames, renderFields, saveFrames } from '../bake.ts';
import { revisedFields } from '../look-versions.ts';
import type { Catalog } from './catalog.ts';
import type { Box } from './check.ts';
import { createClaudeAdapter } from './claude.ts';
import { createCodexAdapter } from './codex.ts';
import type { ExpandError } from './expand.ts';
import { boosted, explore, LEVELS } from './explore.ts';
import { createFleetAdapter, hasMemoryCap } from './fleet.ts';
import { createIdeaLog, type IdeaLog, type IdeaLogs, type Outcome, type Round } from './idea-log.ts';
import { describeDocs, describeRounds, describeUses, dropped, NO_USES } from './log-line.ts';
import { Interrupted } from './proc.ts';
import type { Registry } from './models.ts';
import { buildPrompt, buildRefineMessage } from './prompt.ts';
import { refineHistory } from './refine-history.ts';
import { type Composition, decompose, diffCompositions, keepSwitches } from './refine.ts';
import { keepUntouched } from './edits.ts';
import { compose, type Critique, type Rounds } from './rounds.ts';
import { sketchRefine } from './sketch-refine.ts';
import { sketchLook } from './sketch.ts';
import type { Logger } from '../http.ts';
import type { Store, StoredLook } from '../store.ts';

export { GenerateError, validateLook };

const FALLBACK_ERROR = 'Something went wrong while turning this idea into a look.';
/** The guide, the output schema, the catalog and the library docs (path → markdown): built once per library and rig,
 * the same bytes on every call (so it caches). */
export type Prompt = { system: string, schema: Record<string, unknown>, catalog: Catalog, docs?: Map<string, string> };
/** A follow-up turn: the model's previous answer and what expanding or rendering it found wrong (`message`, when
 * given, is the whole turn instead: a critique, with its stills as PNGs in `images`). */
export type Repair = { answer: unknown, errors: ExpandError[], message?: string, images?: Uint8Array[] };
/** What an adapter is given (SPEC "Generators"), and what makes a look of it: raw output, cleaned by validateLook.
 * `docsRead`: where an adapter notes each library doc the model read, for the log; `docsGiven`: the docs its turn
 * carries (docs-turn.ts); `schema`: an answer to this schema instead of a look (no read_doc; returned as it parsed);
 * `images`: PNGs shown with the first turn; `journal`: the idea's log, and `round`: its round (calls go there). */
export type Context = { text: string, user: { id: string, username?: string, role?: string },
  library: LibraryEntry[], rig: Rig | null, groups: RigGroup[], idea?: { id: string }, prompt?: () => Prompt,
  turn?: string, repair?: Repair, signal?: AbortSignal, docsRead?: string[], docsGiven?: string[],
  schema?: Record<string, unknown>, images?: Uint8Array[], journal?: Pick<IdeaLog, 'begin' | 'note'>, round?: Round };
export type Adapter = { name?: string, generate(ctx: Context): unknown };
type Route = { id: string, label: string, via: string, entry?: ModelEntry };
type Explored = Awaited<ReturnType<typeof explore>>;
type Job = { id: string, route: Route, queuedAt: number, again?: true };
const LABELS: Record<string, string> = { sketch: 'Sketch', claude: 'Claude', codex: 'Codex', fleet: 'Fleet' };
const PROMPTED = new Set(['claude', 'codex']);
const LANE_DEFAULTS: Record<string, number> = { claude: 4, codex: 2, sketch: 4 };
const CRITIQUE_BUDGET_MS = Number(process.env.STUDIO_CRITIQUE_BUDGET_MS) || 90_000;

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
 * STUDIO_GENERATOR_FALLBACK, the foundry's one-shot generator (a model or transport; else sketch);
 * loadVersion: changes when the library or rig does (the prompt is built again only then); box and lane: the render
 * box and the bakes' lane, for the render check and critique (none: no check); interruptGraceMs: how long a call
 * cut by a stray stop signal waits for the server's own stop before it runs again; ideaLogs: where each idea's log
 * goes (none: counted in memory only).
 */
export function createQueue({
  store, loadLibrary = () => [], loadRig = () => null, loadVersion, models, adapterName = process.env.STUDIO_GENERATOR
    || 'sketch', log = console, adapters = {}, concurrency = Number(process.env.STUDIO_GENERATOR_CONCURRENCY) || 0,
  fallbackName = process.env.STUDIO_GENERATOR_FALLBACK || '', framesDir, foundry = foundryFromEnv(), codexBin, box,
  lane: bakeLane, critiqueBudgetMs = CRITIQUE_BUDGET_MS, interruptGraceMs = 2000, ideaLogs,
}: { store: Pick<Store, 'ideas' | 'looks'> & Partial<Store>, loadLibrary?: () => LibraryEntry[],
  loadRig?: () => Rig | null | Promise<Rig | null>, loadVersion?: () => string, models?: Registry,
  adapterName?: string, log?: Logger, adapters?: Record<string, Adapter | Adapter['generate']>, concurrency?: number,
  fallbackName?: string, framesDir?: string, foundry?: Partial<ReturnType<typeof foundryFromEnv>>,
  codexBin?: string, box?: Box, lane?: Parameters<typeof compose>[0]['lane'], critiqueBudgetMs?: number,
  interruptGraceMs?: number, ideaLogs?: IdeaLogs }) {
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
  const pending = () => [...lanes.values()].reduce((n, l) => n + l.running + l.jobs.length, 0);
  const notify = (id: string) => watchers.get(id)?.forEach((fn) => fn());

  function start(l: { running: number, jobs: Job[] }, job: Job) {
    l.running++;
    runJob(job)
      .catch((err) => log.error?.(`[generate] job ${job.id} crashed: ${err?.stack || err}`))
      .then((again) => {
        l.running--;
        active.delete(job.id);
        if (again === true && !stopping) {
          active.add(job.id);
          l.jobs.push({ ...job, again: true, queuedAt: Date.now() });
        }
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
  type Prepared = { version: string, library: LibraryEntry[], rig: Rig | null, groups: RigGroup[], prompt?: Prompt };
  let prepared: Prepared | null = null;
  // Jobs that start together share one load of a version (each loading its own let them race).
  let loading: { version: string, done: Promise<Prepared> } | null = null;
  function prepare(): Promise<Prepared> {
    const version = loadVersion?.() ?? '';
    if (version && prepared?.version === version) return Promise.resolve(prepared);
    if (version && loading?.version === version) return loading.done;
    const done = (async (): Promise<Prepared> => {
      const [library = [], rig = null] = await Promise.all([loadLibrary(), loadRig()]);
      if (!version && prepared && prepared.library === library && prepared.rig === rig) return prepared;
      prepared = { version, library, rig, groups: Array.isArray(rig?.groups) ? rig.groups : [] };
      return prepared;
    })();
    if (version) {
      const mine = { version, done };
      loading = mine;
      done.catch(() => {}).finally(() => { if (loading === mine) loading = null; });
    }
    return done;
  }
  const promptOf = (p: Prepared) => (p.prompt ??= buildPrompt(p));

  /** What a refinement starts from: the look as a composition, the aim, its history, and (a critique asked for
   * alone) the composition as the answer to critique. */
  type Refining = { look: StoredLook, comp: Composition, aim: string, history: string, start?: Composition };
  function refining(idea: Idea, catalog: Catalog): Refining {
    const look = idea.lookId ? store.looks.get(idea.lookId) : null;
    if (!look || look.owner !== idea.owner) throw new GenerateError('The look to refine is gone.', 'no such look');
    const comp = decompose(look, catalog), from = look.ideaId ? store.ideas.get(look.ideaId)?.text : '';
    const aim = idea.text || from || `${look.title}. ${look.summary ?? ''}`;
    const history = refineHistory(store.ideas.list((i) => i.lookId === look.id), idea, from);
    return { look, comp, aim, history, ...(!idea.text && !idea.refine?.fix ? { start: comp } : {}) };
  }

  /** The look from the route's adapter, validated, in rounds for a prompted model. */
  async function lookFrom(ctx: Context, by: Route, refine?: Refining & { critique?: true }, level: Explore = 'quick') {
    const t0 = Date.now();
    if (refine && !PROMPTED.has(by.via) && by.via !== 'sketch') {
      throw new GenerateError(`${by.label} cannot refine a look.`, `refine by ${by.via}`);
    }
    const adapter = adapterFor(by), catalog = PROMPTED.has(by.via) || refine ? ctx.prompt?.().catalog : undefined;
    const mode: Critique | undefined = by.entry?.critique ?? (refine?.critique ? 'images' : undefined);
    const rounds = (a: Adapter, o: { critique?: Critique, box?: Box, edit?: Composition }) => compose({ adapter: a,
      ctx, catalog: catalog!, ...o, lane: bakeLane, aim: refine?.aim, start: refine?.start, startedAt: t0,
      budgetMs: critiqueBudgetMs, stopping: () => stopping, log });
    const lv = PROMPTED.has(by.via) && catalog && ctx.prompt && !refine && level !== 'quick' ? level : null;
    const entry = lv ? boosted(by.via as Transport, by.entry, lv) : by.entry;
    ctx.journal?.note({ model: by.id, via: by.via, ...(entry?.model ? { name: entry.model } : {}),
      ...(entry?.effort ? { effort: entry.effort } : {}) });
    const out: Partial<Explored> & Pick<Rounds, 'raw' | 'look'> = lv ? await explore({
      adapter: adapterFor({ ...by, entry }), ctx, catalog: catalog!, critique: mode, box,
      lane: bakeLane, startedAt: t0, budgetMs: LEVELS[lv].budgetMs, stopping: () => stopping, log, level: lv })
      : PROMPTED.has(by.via) && catalog && ctx.prompt ? await rounds(adapter, { critique: mode, box,
        edit: refine?.start ? undefined : refine?.comp })
      : refine && catalog && by.via === 'sketch'
        ? await rounds({ generate: () => sketchRefine(refine.comp, ctx.text, { ...ctx, catalog }) }, {})
      : await (async () => {
        const raw = await adapter.generate(ctx);
        return { raw, look: validateLook(raw, ctx) };
      })();
    return { ...out, used: by, request: Date.now() - t0, parse: 0 };
  }

  const update = async (id: string, patch: Partial<Idea>) => {
    await store.ideas.update(id, patch);
    notify(id);
  };

  /** One idea's job → true when it should run once more (it was interrupted). */
  async function runJob({ id, route: r, queuedAt, again }: Job) {
    const idea = await store.ideas.get(id);
    if (!idea) return log.warn?.(`[generate] idea ${id} no longer exists`);
    if (idea.status === 'ready' && idea.lookId) return; // already done (re-enqueued after a restart)
    const started = Date.now(), ac = new AbortController();
    const open = (meta: Record<string, unknown>) => ideaLogs?.open(id, meta) ?? createIdeaLog({ meta });
    const journal = open({ request: idea.text, level: idea.refine ? undefined : idea.explore ?? 'explore',
      ...(idea.refine ? { refine: { lookId: idea.lookId, ...idea.refine } } : {}), model: r.id,
      attempt: again ? 2 : 1 });
    let outcome: Outcome = { status: 'interrupted' };
    running.add(ac);
    await update(id, { status: 'generating', generator: r.id, by: r.label, error: null });
    try {
      const owner = (await store.users?.get?.(idea.owner)) || null;
      const user = owner ? { id: owner.id, username: owner.username, role: owner.role } : { id: idea.owner };
      const base = await prepare();
      if (PROMPTED.has(r.via) || idea.refine) promptOf(base);
      const prompt = Date.now() - started;
      const ctx: Context = { text: String(idea.text ?? ''), user, library: base.library, rig: base.rig,
        groups: base.groups, idea: { id }, prompt: () => promptOf(base), signal: ac.signal, docsRead: [], journal };
      const refine = idea.refine ? { ...refining(idea, promptOf(base).catalog), ...idea.refine } : undefined;
      if (refine) ctx.turn = buildRefineMessage(refine.comp, idea.text, idea.refine?.fix, refine.history);
      const out = await lookFrom(ctx, r, refine, idea.explore), { look, used, request } = out;
      const { tokens, rounds: done } = journal.summary(), rounds = done.length ? { rounds: done } : {};
      const timing = { wait: started - queuedAt, prompt, request, parse: out.parse, total: 0,
        ...(tokens ? { tokens } : {}),
        ...(out.check !== undefined ? { check: out.check } : {}),
        ...(out.critique ? { critique: out.critique.ms } : {}), ...(out.sketch ? { sketch: out.sketch.ms } : {}) };
      const read = PROMPTED.has(used.via) ? ctx.docsRead : undefined;
      const how = `${describeRounds(out)}; ${describeUses(out.uses ?? NO_USES)}${describeDocs(read)}${
        dropped(look.dropped)}`;
      if (refine) {
        const kept = keepUntouched(refine.look.layers as typeof look.layers, refine.comp, out.raw, look.layers);
        const changes = await revise(refine.look, { ...look, layers: kept }, promptOf(base).catalog);
        timing.total = Date.now() - queuedAt;
        outcome = { status: 'ready', lookId: refine.look.id };
        await update(id, { status: 'ready', generator: used.id, by: used.label, error: null, timing, changes, ...rounds,
          ...(out.critique ? { verdict: out.critique.outcome.slice(0, 80) } : {}) });
        return log.info?.(`[generate] refinement ${id} ready via ${used.id} in ${timing.total} ms (request ${request}`
          + `${how}; ${changes.length} changes; look ${refine.look.id})`);
      }
      const { bake: made, frames } = (out.raw ?? {}) as { bake?: Bake, frames?: unknown };
      const bake = made && typeof made === 'object' ? { ...made, layersHash: layersHash(renderFields(look)) } : null;
      const saved = await store.looks.create({
        owner: idea.owner, ownerName: owner?.username || '', title: look.title, summary: look.summary,
        layers: look.layers,
        ...(look.duration !== undefined ? { duration: look.duration } : {}),
        ...(look.globals ? { globals: look.globals } : {}), ...(look.automation ? { automation: look.automation } : {}),
        ...(look.bpm !== undefined ? { bpm: look.bpm } : {}),
        shared: false, reviewed: false, ideaId: id, chain: CHAIN, ...(bake ? { bake } : {}),
      });
      if (bake?.frames) await keepFrames(saved.id, frames, bake);
      timing.total = Date.now() - queuedAt;
      outcome = { status: 'ready', lookId: saved.id };
      await update(id, { status: 'ready', lookId: saved.id, generator: used.id, by: used.label, error: null, timing,
        ...rounds, ...(out.sketch?.took ? { took: out.sketch.took } : {}) });
      log.info?.(`[generate] idea ${id} ready via ${used.id} in ${timing.total} ms `
        + `(queued ${timing.wait}, request ${request}${how}; look ${saved.id})`);
    } catch (err) {
      // A stop that reached the call before the server (a service stop signals the whole group) is still a stop.
      if (err instanceof Interrupted && !stopping) await new Promise((r) => setTimeout(r, interruptGraceMs));
      outcome = { status: 'interrupted', detail: String((err as Error)?.message || err).slice(0, 500) };
      if (stopping) return; // left as it is: the next start queues it again
      if (err instanceof Interrupted && !again) {
        log.warn?.(`[generate] idea ${id}: ${err.message}; trying it again`);
        await update(id, { status: 'queued' });
        return true;
      }
      log.warn?.(`[generate] ${idea.refine ? 'refinement' : 'idea'} ${id} failed via ${r.id}: ${
        (err as Error)?.message || err}`);
      const error = err instanceof GenerateError ? err.userMessage : FALLBACK_ERROR;
      outcome = { status: 'failed', error, detail: String((err as Error)?.message || err).slice(0, 500) };
      const { rounds } = journal.summary();
      await update(id, { status: 'failed', error, ...(rounds.length ? { rounds } : {}) });
    } finally {
      await journal.finish(outcome);
      running.delete(ac);
    }
  }

  /** A refinement saved onto its look as an edit (a version of what was there; no bake, no review) → what changed;
   * nothing is saved when nothing did, and nothing over an edit made while it ran. */
  async function revise(from: StoredLook, look: ReturnType<typeof validateLook>, catalog: Catalog) {
    const lookId = from.id, now = store.looks.get(lookId);
    if (!now) throw new GenerateError('The look to refine is gone.', 'deleted while refining');
    if (layersHash(renderFields(now)) !== layersHash(renderFields(from))) {
      throw new GenerateError('The look was edited while it was being refined; ask again.', 'edited while refining');
    }
    const next = { layers: keepSwitches(now.layers as Record<string, unknown>[], look.layers),
      duration: look.duration ?? now.duration, globals: look.globals ?? now.globals,
      automation: look.automation ?? now.automation, bpm: look.bpm ?? now.bpm };
    const changes = diffCompositions(decompose(now, catalog), decompose({ ...now, ...next }, catalog));
    if (!changes.length) return changes;
    await store.looks.update(lookId, { ...revisedFields(now), ...next, chain: CHAIN });
    await removeFrames(framesHome || undefined, lookId).catch(() => {});
    return changes;
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
      if (!stopping && busy()) {
        log.info?.(`[generate] stopping: ${pending()} ideas left queued or cut short; they resume at the next start`);
      }
      stopping = true;
      for (const l of lanes.values()) l.jobs.splice(0).forEach((j) => active.delete(j.id));
      running.forEach((ac) => ac.abort());
      if (!busy()) waiters.splice(0).forEach((r) => r());
    },
    idle: () => (!busy() ? Promise.resolve() : new Promise<void>((r) => waiters.push(r))),
    get size() { return pending(); },
  };
}
