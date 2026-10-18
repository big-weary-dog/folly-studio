// The idea → look queue, in-process. Each job: idea 'generating', an adapter turns the text into a look,
// validate.js checks it, the look is saved and the idea 'ready' (or 'failed', with a user-safe error).
// An adapter may also return `bake` (a checkFrames record, kept on the look) and `frames` (stored).
// The Fleet foundry (deep ideas: STUDIO_GENERATOR=fleet) is opt-in, STUDIO_FOUNDRY=on, one job at a time
// in a slot of its own. While it is off or busy, deep ideas go to the one-shot generator
// (STUDIO_GENERATOR_FALLBACK, else sketch), or wait for it with STUDIO_FOUNDRY_WAIT=1.

import path from 'node:path';

import { layersHash, saveFrames } from '../bake.js';
import { renderFields } from '../look-rules.js';
import { createClaudeAdapter } from './claude.js';
import { createFleetAdapter, hasMemoryCap } from './fleet.js';
import { sketchLook } from './sketch.js';
import { GenerateError, validateLook } from './validate.js';

export { GenerateError, validateLook } from './validate.js';

const FALLBACK_ERROR = 'Something went wrong while turning this idea into a look.';

/** The built-in adapters, created on first use so each reads the environment then. */
function defaultAdapters(log) {
  const made = {};
  const lazy = (name, make) => ({ name, generate: (args) => (made[name] ||= make()).generate(args) });
  return {
    sketch: { name: 'sketch', generate: async ({ text, library, groups }) => sketchLook({ text, library, groups }) },
    claude: lazy('claude', () => createClaudeAdapter({ log })),
    fleet: lazy('fleet', () => createFleetAdapter({ log })),
  };
}

/** The foundry's settings from the environment: { on, wait, memoryCap() → Promise<boolean> }. */
export function foundryFromEnv(env = process.env) {
  const yes = (v) => /^(on|1|true)$/i.test(v || '');
  return { on: yes(env.STUDIO_FOUNDRY), wait: yes(env.STUDIO_FOUNDRY_WAIT), memoryCap: () => hasMemoryCap() };
}

/**
 * createQueue({ store, loadLibrary, loadRig, adapterName, log, adapters?, concurrency?, fallbackName?,
 *   framesDir?, foundry? }) → { adapterName, enqueue(idea | id) → false when already queued, idle(), size }.
 * adapterName: STUDIO_GENERATOR, sketch (default) | claude | fleet; adapters: name → { generate } or a function;
 * concurrency: STUDIO_GENERATOR_CONCURRENCY (1); fallbackName: STUDIO_GENERATOR_FALLBACK, tried when the main
 * one fails and the one-shot generator for deep ideas; framesDir: <store.dataDir>/frames; foundry:
 * foundryFromEnv().
 */
export function createQueue({
  store, loadLibrary = () => [], loadRig = () => null, adapterName = process.env.STUDIO_GENERATOR || 'sketch',
  log = console, adapters, concurrency = Number(process.env.STUDIO_GENERATOR_CONCURRENCY) || 1,
  fallbackName = process.env.STUDIO_GENERATOR_FALLBACK || '', framesDir, foundry = foundryFromEnv(),
} = {}) {
  if (!store?.ideas || !store?.looks) throw new Error('createQueue needs a store with ideas and looks');
  const framesHome = framesDir ?? (store.dataDir ? path.join(store.dataDir, 'frames') : '');
  const registry = { ...defaultAdapters(log), ...adapters };
  const adapter = (name) => (typeof registry[name] === 'function' ? { generate: registry[name] } : registry[name]);
  let primary = String(adapterName || 'sketch').trim().toLowerCase();
  if (!registry[primary]) {
    log.error?.(`[generate] unknown generator "${adapterName}"; using sketch`);
    primary = 'sketch';
  }
  const fallback = fallbackName && fallbackName !== primary && registry[fallbackName] ? fallbackName : '';
  const limit = Math.max(1, Math.floor(concurrency));
  // Deep ideas: the foundry's, one at a time; otherwise (or while it is busy) the one-shot generator's.
  const deep = primary === 'fleet';
  const oneShot = deep ? (fallback && fallback !== 'fleet' ? fallback : 'sketch') : primary;
  const foundryOn = deep && foundry.on === true;
  if (deep && !foundryOn) {
    log.warn?.(`[generate] the Fleet foundry is off (STUDIO_FOUNDRY=on runs it); ideas go to ${oneShot}`);
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
  const pending = []; // idea ids waiting
  const active = new Set(); // idea ids queued or running: enqueue is idempotent per id
  let running = 0, foundryBusy = false, waiters = [];

  function start(id, name) {
    const inFoundry = name === 'fleet';
    if (inFoundry) foundryBusy = true;
    else running++;
    runJob(id, name)
      .catch((err) => log.error?.(`[generate] job ${id} crashed: ${err?.stack || err}`))
      .finally(() => {
        if (inFoundry) foundryBusy = false;
        else running--;
        active.delete(id);
        pump();
        if (!running && !foundryBusy && !pending.length) waiters.splice(0).forEach((r) => r());
      });
  }

  function pump() {
    while (pending.length) {
      if (foundryOn && !foundryBusy) start(pending.shift(), 'fleet');
      else if (foundryOn && foundry.wait) break; // deep ideas wait for the foundry
      else if (running < limit) start(pending.shift(), oneShot);
      else break;
    }
  }

  /** The look from `name`'s adapter, validated; the fallback adapter tries when that one fails. */
  async function lookFrom(ctx, id, name) {
    try {
      const raw = await adapter(name).generate(ctx);
      return { raw, look: validateLook(raw, ctx), used: name };
    } catch (err) {
      if (!fallback || fallback === name) throw err;
      log.warn?.(`[generate] ${name} failed for idea ${id} (${err?.message}); falling back to ${fallback}`);
      const raw = await adapter(fallback).generate(ctx);
      const look = validateLook(raw, ctx);
      const why = err instanceof GenerateError ? err.userMessage : 'The AI generator was unavailable.';
      look.summary = `${why} ${look.summary}`.slice(0, 400);
      return { raw, look, used: fallback };
    }
  }

  async function runJob(id, name) {
    const idea = await store.ideas.get(id);
    if (!idea) return log.warn?.(`[generate] idea ${id} no longer exists`);
    if (idea.status === 'ready' && idea.lookId) return; // already done (re-enqueued after a restart)
    await store.ideas.update(id, { status: 'generating', generator: name, error: null });
    const started = Date.now();
    try {
      const owner = (await store.users?.get?.(idea.owner)) || null;
      const user = owner ? { id: owner.id, username: owner.username, role: owner.role } : { id: idea.owner };
      const [library, rig] = await Promise.all([loadLibrary(), loadRig()]);
      const groups = Array.isArray(rig?.groups) ? rig.groups : [];
      const ctx = { text: String(idea.text ?? ''), user, library: library || [], rig, groups, idea: { id } };
      const { raw, look, used } = await lookFrom(ctx, id, name);
      if (look.dropped.length) log.warn?.(`[generate] idea ${id}: dropped ${look.dropped.join('; ')}`);
      const bake = raw?.bake && typeof raw.bake === 'object'
        ? { ...raw.bake, layersHash: layersHash(renderFields(look)) } : null;
      const saved = await store.looks.create({
        owner: idea.owner, ownerName: owner?.username || '', title: look.title, summary: look.summary,
        layers: look.layers,
        ...(look.duration !== undefined ? { duration: look.duration } : {}),
        ...(look.globals ? { globals: look.globals } : {}), ...(look.automation ? { automation: look.automation } : {}),
        shared: false, reviewed: false, ideaId: id, ...(bake ? { bake } : {}),
      });
      if (bake?.frames) await keepFrames(saved.id, raw.frames, bake);
      await store.ideas.update(id, { status: 'ready', lookId: saved.id, generator: used, error: null });
      log.info?.(`[generate] idea ${id} ready via ${used} in ${Date.now() - started} ms (look ${saved.id})`);
    } catch (err) {
      log.warn?.(`[generate] idea ${id} failed via ${name}: ${err?.message || err}`);
      const error = err instanceof GenerateError ? err.userMessage : FALLBACK_ERROR;
      await store.ideas.update(id, { status: 'failed', error });
    }
  }

  async function keepFrames(lookId, bytes, bake) {
    try {
      if (!framesHome || !(bytes instanceof Uint8Array)) throw new Error('no frames directory');
      await saveFrames(framesHome, lookId, bytes);
    } catch (err) {
      log.warn?.(`[generate] look ${lookId}: could not store its frames: ${err?.message || err}`);
      const reason = 'The baked frames could not be stored.';
      await store.looks.update(lookId, { bake: { ...bake, ok: false, status: 'failed', frames: undefined, reason } });
    }
  }

  return {
    adapterName: deep && !foundryOn ? oneShot : primary, foundry: foundryOn,
    enqueue(idea) {
      const id = typeof idea === 'object' && idea ? idea.id : idea;
      if (id == null || active.has(id)) return false;
      active.add(id);
      pending.push(id);
      pump();
      return true;
    },
    idle: () => (!running && !foundryBusy && !pending.length ? Promise.resolve()
      : new Promise((r) => waiters.push(r))),
    get size() { return pending.length + running + (foundryBusy ? 1 : 0); },
  };
}
