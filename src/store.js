// JSON-file document store: a file per collection, loaded at start, kept in memory, written atomically
// (tmp + fsync + rename), each collection's writes serialized and coalesced. Objects handed out are copies.
//   store.looks.create(obj) → obj (adds id, createdAt, updatedAt);  get(id) → obj | null;  list(filter?) → [obj]
//   update(id, patch) → obj | null (shallow; undefined deletes a key);  remove(id) → boolean;  await store.flush()

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const COLLECTIONS = ['users', 'sessions', 'ideas', 'looks'];
/** Random url-safe id (16 chars for the default 12 bytes). */
export const newId = (bytes = 12) => randomBytes(bytes).toString('base64url');
const copy = (v) => (v === undefined || v === null ? v : structuredClone(v));

export async function createStore(dataDir, { collections = COLLECTIONS, log = console } = {}) {
  await fsp.mkdir(dataDir, { recursive: true });
  const store = {}, states = [];
  for (const name of collections) {
    states.push(await openCollection(path.join(dataDir, `${name}.json`), log));
    store[name] = states.at(-1).api;
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
  const text = await fsp.readFile(file, 'utf8').catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
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

  let chain = Promise.resolve(), queued = false, lastError = null, tmpSeq = 0;

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
    get: (id) => copy(map.get(id)) ?? null,
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

  return { api, pending: () => chain, queued: () => queued, lastError: () => lastError };
}
