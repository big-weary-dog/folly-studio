// The idea → look queue. The server calls enqueue(idea) right after creating the idea; jobs
// run in-process, STUDIO_GENERATOR_CONCURRENCY at a time (default 1). Each job: idea status
// 'generating', the adapter turns the text into a look, validate.js checks it statically, the
// look is saved and the idea set 'ready' (or 'failed' with a short, user-safe error). An adapter
// may also return `bake` (a record from src/bake.js checkFrames) and `frames` (the checked FSEQ
// bytes): the record is kept on the look and the frames go to <framesDir>/<lookId>.fseq.

import path from 'node:path';

import { createClaudeAdapter } from './claude.js';
import { createFleetAdapter } from './fleet.js';
import { layersHash, saveFrames } from '../bake.js';
import * as sketch from './sketch.js';
import { GenerateError, validateLook } from './validate.js';

export { GenerateError, validateLook } from './validate.js';

const FALLBACK_ERROR = 'Something went wrong while turning this idea into a look.';

/** The built-in adapters, created lazily so each reads the environment when first used. */
function defaultAdapters(log) {
  const made = {};
  const lazy = (name, make) => ({
    name,
    generate: (args) => {
      made[name] ||= make();
      return made[name].generate(args);
    },
  });
  return {
    sketch: { name: 'sketch', generate: sketch.generate },
    claude: lazy('claude', () => createClaudeAdapter({ log })),
    fleet: lazy('fleet', () => createFleetAdapter({ log })),
  };
}

const asAdapter = (a) => (typeof a === 'function' ? { generate: a } : a);

/**
 * @param {object} o
 * @param {object} o.store         { users, ideas, looks } with get/list/create/update
 * @param {() => any} o.loadLibrary  → [{ name, title, summary, tags, code }]
 * @param {() => any} o.loadGroups   → cathedral group array
 * @param {string} [o.adapterName]   STUDIO_GENERATOR: sketch (default) | claude | fleet
 * @param {object} [o.adapters]      name → adapter ({ generate } or a function); overrides built-ins
 * @param {number} [o.concurrency]   STUDIO_GENERATOR_CONCURRENCY, default 1
 * @param {string} [o.fallbackName]  STUDIO_GENERATOR_FALLBACK: adapter to try when the main one fails (off by default)
 * @param {string} [o.framesDir]     where baked frames go (default <store.dataDir>/frames)
 */
export function createQueue({
  store,
  loadLibrary = () => [],
  loadGroups = () => [],
  adapterName = process.env.STUDIO_GENERATOR || 'sketch',
  log = console,
  adapters,
  concurrency = Number(process.env.STUDIO_GENERATOR_CONCURRENCY) || 1,
  fallbackName = process.env.STUDIO_GENERATOR_FALLBACK || '',
  framesDir,
} = {}) {
  if (!store?.ideas || !store?.looks) throw new Error('createQueue needs a store with ideas and looks');
  const framesHome = framesDir ?? (store.dataDir ? path.join(store.dataDir, 'frames') : '');
  const registry = { ...defaultAdapters(log), ...(adapters || {}) };
  let primary = String(adapterName || 'sketch').trim().toLowerCase();
  if (!registry[primary]) {
    log.error?.(`[generate] unknown generator "${adapterName}"; using sketch`);
    primary = 'sketch';
  }
  const fallback = fallbackName && fallbackName !== primary && registry[fallbackName] ? fallbackName : '';
  const limit = Math.max(1, Math.floor(concurrency));

  const pending = []; // idea ids waiting
  const active = new Set(); // idea ids queued or running: enqueue is idempotent per id
  let running = 0;
  let waiters = [];

  function settle() {
    if (running === 0 && pending.length === 0) {
      const w = waiters;
      waiters = [];
      w.forEach((r) => r());
    }
  }

  function pump() {
    while (running < limit && pending.length) {
      const id = pending.shift();
      running++;
      runJob(id)
        .catch((err) => log.error?.(`[generate] job ${id} crashed: ${err?.stack || err}`))
        .finally(() => {
          running--;
          active.delete(id);
          pump();
          settle();
        });
    }
  }

  async function runJob(id) {
    const idea = await store.ideas.get(id);
    if (!idea) return log.warn?.(`[generate] idea ${id} no longer exists`);
    if (idea.status === 'ready' && idea.lookId) return; // already done (re-enqueued after a restart)
    await store.ideas.update(id, { status: 'generating', generator: primary, error: null });
    const started = Date.now();
    try {
      const owner = (await store.users?.get?.(idea.owner)) || null;
      const user = owner ? { id: owner.id, username: owner.username, role: owner.role } : { id: idea.owner };
      const [library, groups] = await Promise.all([loadLibrary(), loadGroups()]);
      const ctx = { text: String(idea.text ?? ''), user, library: library || [], groups: groups || [], idea: { id } };

      let look;
      let raw;
      let used = primary;
      try {
        raw = await asAdapter(registry[primary]).generate(ctx);
        look = validateLook(raw, ctx);
      } catch (err) {
        if (!fallback) throw err;
        log.warn?.(`[generate] ${primary} failed for idea ${id} (${err?.message}); falling back to ${fallback}`);
        raw = await asAdapter(registry[fallback]).generate(ctx);
        look = validateLook(raw, ctx);
        used = fallback;
        const why = err instanceof GenerateError ? err.userMessage : 'The AI generator was unavailable.';
        look.summary = `${why} ${look.summary}`.slice(0, 400);
      }
      if (look.dropped.length) log.warn?.(`[generate] idea ${id}: dropped ${look.dropped.join('; ')}`);
      const bake = raw?.bake && typeof raw.bake === 'object' ? { ...raw.bake, layersHash: layersHash(look.layers) } : null;

      const saved = await store.looks.create({
        owner: idea.owner,
        ownerName: owner?.username || '',
        title: look.title,
        summary: look.summary,
        layers: look.layers,
        shared: false,
        reviewed: false,
        ideaId: id,
        ...(bake ? { bake } : {}),
      });
      if (bake?.frames) await keepFrames(saved.id, raw.frames, bake);
      await store.ideas.update(id, { status: 'ready', lookId: saved.id, generator: used, error: null });
      log.info?.(`[generate] idea ${id} ready via ${used} in ${Date.now() - started} ms (look ${saved.id})`);
    } catch (err) {
      const message = err instanceof GenerateError ? err.userMessage : FALLBACK_ERROR;
      log.warn?.(`[generate] idea ${id} failed via ${primary}: ${err?.message || err}`);
      await store.ideas.update(id, { status: 'failed', error: message });
    }
  }

  async function keepFrames(lookId, bytes, bake) {
    try {
      if (!framesHome || !(bytes instanceof Uint8Array)) throw new Error('no frames directory');
      await saveFrames(framesHome, lookId, bytes);
    } catch (err) {
      log.warn?.(`[generate] look ${lookId}: could not store its frames: ${err?.message || err}`);
      await store.looks.update(lookId, { bake: { ...bake, ok: false, status: 'failed', frames: undefined, reason: 'The baked frames could not be stored.' } });
    }
  }

  return {
    adapterName: primary,
    /** Queue an idea (record or id). Returns false if it is already queued or running. */
    enqueue(idea) {
      const id = typeof idea === 'object' && idea ? idea.id : idea;
      if (id == null || active.has(id)) return false;
      active.add(id);
      pending.push(id);
      pump();
      return true;
    },
    /** Resolves when nothing is queued or running. */
    idle() {
      if (running === 0 && pending.length === 0) return Promise.resolve();
      return new Promise((r) => waiters.push(r));
    },
    get size() {
      return pending.length + running;
    },
  };
}
