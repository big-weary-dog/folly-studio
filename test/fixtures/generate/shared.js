// Shared by the generate tests: the fixture library, the Folly's rig and groups, a temp dir, mocked Messages API
// streams and a small in-memory store.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEFAULT_MODEL } from '../../../src/generate/claude.js';

export const FIX = fileURLToPath(new URL('./', import.meta.url));
export const STUDIO = fileURLToPath(new URL('../../../', import.meta.url));
export const RIG = JSON.parse(fs.readFileSync(path.join(STUDIO, 'public/data/rig.json'), 'utf8'));
export const GROUPS = RIG.groups;
export const LIBRARY = JSON.parse(fs.readFileSync(path.join(FIX, 'library/index.json'), 'utf8'))
  .map((p) => ({ ...p, code: fs.readFileSync(path.join(FIX, 'library', `${p.name}.js`), 'utf8') }));
export const byName = (n) => LIBRARY.find((p) => p.name === n);
export const quiet = { info() {}, warn() {}, error() {} };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-generate-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
export const tmp = (name) => fs.mkdtempSync(path.join(tmpRoot, `${name}-`));
export const goodLayer = (extra = {}) => ({ title: 'Sea', groups: ['cathedral'], blend: 'add', level: 1,
  code: byName('ocean-swell').code, ...extra });
export const lookJson = () => JSON.stringify({ title: 'Reef', summary: 'Blue water', layers: [goodLayer()] });

/** A Messages API event stream, CRLF and cut into awkward chunks to exercise the parser. */
export function sse(events) {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(body.replace(/\n/g, '\r\n'));
  return new Response(new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37));
      c.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
export const streamOf = (text, stop = 'end_turn', model = DEFAULT_MODEL) => [
  { type: 'message_start', message: { model, content: [] } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  ...text.match(/.{1,25}/gs).map((t) => ({ type: 'content_block_delta', index: 1,
    delta: { type: 'text_delta', text: t } })),
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 9 } },
  { type: 'message_stop' },
];
export const jsonRes = (status, body, headers = {}) => new Response(JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...headers } });

export function fakeStore() {
  const tables = { users: new Map(), ideas: new Map(), looks: new Map() };
  const history = [];
  let n = 0;
  const table = (name) => ({
    get: (id) => (tables[name].has(id) ? structuredClone(tables[name].get(id)) : null),
    list: (fn = () => true) => [...tables[name].values()].filter(fn).map((x) => structuredClone(x)),
    create(obj) {
      const rec = { id: `${name[0]}${++n}`, ...obj, createdAt: 'now', updatedAt: 'now' };
      tables[name].set(rec.id, rec);
      return structuredClone(rec);
    },
    async update(id, patch) {
      await new Promise((r) => setImmediate(r));
      const rec = { ...tables[name].get(id), ...patch };
      tables[name].set(id, rec);
      if (name === 'ideas') history.push([id, patch.status]);
      return structuredClone(rec);
    },
  });
  return { users: table('users'), ideas: table('ideas'), looks: table('looks'), tables, history };
}

/** A queue on a fake store with one user; idea(text) files an idea for them. */
export function queueSetup(createQueue, opts = {}) {
  const store = fakeStore();
  const user = store.users.create({ username: 'ana', role: 'member', passwordHash: 'secret' });
  const idea = (text) => store.ideas.create({ owner: user.id, text, status: 'queued', generator: 'sketch' });
  const queue = createQueue({ store, loadLibrary: () => LIBRARY, loadRig: async () => RIG, log: quiet, ...opts });
  return { store, user, idea, queue };
}
