// JSON-file document store: a file per collection, loaded at start, kept in memory, written atomically
// (tmp + fsync + rename), each collection's writes serialized and coalesced. Objects handed out are copies; create()
// adds id, createdAt and updatedAt; update() is shallow, and undefined deletes a key.

import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { Idea, Look, User } from '../shared/schemas/api.ts';
import type { Log } from './http.ts';

type Doc = { id: string, createdAt: string, updatedAt: string };
export type Collection<T extends Doc> = { get(id: string): T | null, list(filter?: (x: T) => unknown): T[],
  create(x: Partial<T>): T, update(id: string, patch: Partial<T>): T | null, remove(id: string): boolean };
export type StoredUser = Doc & Partial<User> & { username: string, passwordHash: string };
export type Session = Doc & { userId: string, expiresAt: string };
/** A look as stored: what GET /api/looks/:id answers (older looks may lack its defaults), and its versions. */
export type StoredLook = Doc & Pick<Look, 'owner' | 'title'> & Partial<Omit<Look, 'versionCount' | keyof Doc>>
  & { versions?: Record<string, unknown>[] };
export type Store = { users: Collection<StoredUser>, sessions: Collection<Session>, ideas: Collection<Idea>,
  looks: Collection<StoredLook>, dataDir: string, flush(): Promise<void> };

const COLLECTIONS = ['users', 'sessions', 'ideas', 'looks'] as const;
/** Random url-safe id (16 chars for 12 bytes). */
const newId = () => randomBytes(12).toString('base64url');
const copy = <T>(v: T): T => (v === undefined || v === null ? v : structuredClone(v));

export async function createStore(dataDir: string, { log = console }: { log?: Pick<Log, 'error'> } = {}) {
  await fsp.mkdir(dataDir, { recursive: true });
  const states = await Promise.all(COLLECTIONS.map((name) => openCollection(path.join(dataDir, `${name}.json`), log)));
  return {
    ...Object.fromEntries(COLLECTIONS.map((name, i) => [name, states[i]!.api])), dataDir,
    async flush() {
      // Writes scheduled while we wait are picked up by the next pass.
      for (let pass = 0; pass < 100; pass++) {
        await Promise.all(states.map((s) => s.pending()));
        if (!states.some((s) => s.queued())) break;
      }
      const failed = states.find((s) => s.lastError());
      if (failed) throw failed.lastError();
    },
  } as Store;
}

async function openCollection(file: string, log: Pick<Log, 'error'>) {
  const map = new Map<string, Doc & Record<string, unknown>>();
  const text = await fsp.readFile(file, 'utf8').catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
  if (text !== undefined && text.trim()) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`store: ${file} is not valid JSON (${(err as Error).message})`, { cause: err });
    }
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
    if (!items) throw new Error(`store: ${file} does not hold an array`);
    for (const item of items) if (item && typeof item.id === 'string') map.set(item.id, item);
  }

  let chain = Promise.resolve(), queued = false, lastError: unknown = null, tmpSeq = 0;

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
        log.error(`store: could not write ${file}:`, err);
        await fsp.rm(tmp, { force: true }).catch(() => {});
      }
    });
    return chain;
  }

  const api: Collection<Doc & Record<string, unknown>> = {
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
      const next: Record<string, unknown> = { ...cur };
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'id' || k === 'createdAt' || k === 'updatedAt') continue;
        if (v === undefined) delete next[k];
        else next[k] = copy(v);
      }
      next.updatedAt = new Date().toISOString();
      map.set(id, next as Doc);
      schedule();
      return copy(next as Doc);
    },
    remove(id) {
      const had = map.delete(id);
      if (had) schedule();
      return had;
    },
  };

  return { api, pending: () => chain, queued: () => queued, lastError: () => lastError };
}
