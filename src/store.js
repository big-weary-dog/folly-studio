// JSON-file document store: one file per collection in the data dir, loaded at
// start, kept in memory, written atomically (tmp file + fsync + rename) with the
// writes for each collection serialized and coalesced.
//
//   const store = await createStore(dataDir);
//   store.looks.create(obj) → obj        (adds id, createdAt, updatedAt)
//   store.looks.get(id) → obj | null
//   store.looks.list(filterFn?) → [obj]  (insertion order)
//   store.looks.update(id, patch) → obj | null   (shallow merge; undefined deletes a key)
//   store.looks.remove(id) → boolean
//   await store.flush()                  (resolves once everything is on disk)
//
// Objects handed out are copies, so callers cannot mutate the store by accident.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const COLLECTIONS = ['users', 'sessions', 'ideas', 'looks'];

/** Random url-safe id (16 chars for the default 12 bytes). */
export function newId(bytes = 12) {
  return randomBytes(bytes).toString('base64url');
}

const copy = (v) => (v === undefined || v === null ? v : structuredClone(v));

export async function createStore(dataDir, { collections = COLLECTIONS, log = console } = {}) {
  await fsp.mkdir(dataDir, { recursive: true });
  const store = {};
  const states = [];
  for (const name of collections) {
    const state = await openCollection(path.join(dataDir, `${name}.json`), log);
    states.push(state);
    store[name] = state.api;
  }
  Object.defineProperties(store, {
    dataDir: { value: dataDir },
    flush: {
      async value() {
        // Writes scheduled while we wait are picked up by the next pass.
        for (let pass = 0; pass < 100; pass++) {
          await Promise.all(states.map((s) => s.pending()));
          if (!states.some((s) => s.queued())) break;
        }
        const failed = states.find((s) => s.lastError());
        if (failed) throw failed.lastError();
      },
    },
  });
  return store;
}

async function openCollection(file, log) {
  const map = new Map();
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (text !== undefined && text.trim()) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`store: ${file} is not valid JSON (${err.message})`);
    }
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
    if (!items) throw new Error(`store: ${file} does not hold an array`);
    for (const item of items) if (item && typeof item.id === 'string') map.set(item.id, item);
  }

  let chain = Promise.resolve();
  let queued = false;
  let lastError = null;
  let tmpSeq = 0;

  function schedule() {
    if (queued) return chain;
    queued = true;
    chain = chain.then(async () => {
      queued = false; // anything changed from here on schedules another write
      const items = [...map.values()];
      const json = items.length ? `[\n${items.map((v) => JSON.stringify(v)).join(',\n')}\n]\n` : '[]\n';
      const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
      try {
        const fh = await fsp.open(tmp, 'w', 0o600);
        try {
          await fh.writeFile(json);
          await fh.sync();
        } finally {
          await fh.close();
        }
        await fsp.rename(tmp, file);
        lastError = null;
      } catch (err) {
        lastError = err;
        (log.error ?? console.error)(`store: could not write ${file}:`, err);
        await fsp.rm(tmp, { force: true }).catch(() => {});
      }
    });
    return chain;
  }

  const api = {
    get(id) {
      return copy(map.get(id)) ?? null;
    },
    list(filterFn) {
      const out = [];
      for (const item of map.values()) if (!filterFn || filterFn(item)) out.push(copy(item));
      return out;
    },
    create(obj = {}) {
      const now = new Date().toISOString();
      let id = obj.id;
      if (id !== undefined) {
        if (typeof id !== 'string' || !id) throw new TypeError('store: id must be a non-empty string');
        if (map.has(id)) throw new Error(`store: duplicate id ${id}`);
      } else {
        do id = newId(); while (map.has(id));
      }
      const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = obj;
      const item = { id, ...copy(rest), createdAt: now, updatedAt: now };
      map.set(id, item);
      schedule();
      return copy(item);
    },
    update(id, patch = {}) {
      const cur = map.get(id);
      if (!cur) return null;
      const next = { ...cur };
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'id' || k === 'createdAt' || k === 'updatedAt') continue;
        if (v === undefined) delete next[k];
        else next[k] = copy(v);
      }
      next.updatedAt = new Date().toISOString();
      map.set(id, next);
      schedule();
      return copy(next);
    },
    remove(id) {
      const had = map.delete(id);
      if (had) schedule();
      return had;
    },
  };

  return {
    api,
    pending: () => chain,
    queued: () => queued,
    lastError: () => lastError,
  };
}
