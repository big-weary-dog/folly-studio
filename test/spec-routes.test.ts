// SPEC "HTTP API" lists every route the server has, and the server has every route it lists: the route table in
// spec/http.md against the routes createServer registers (each path's 405 answer and Fastify's HEAD aside).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { FastifyServerOptions } from 'fastify';
import { afterAll, test, vi } from 'vitest';

const registered: string[] = [];
vi.mock('fastify', async (original) => {
  const { default: Fastify } = await original<typeof import('fastify')>();
  return { default: (opts: FastifyServerOptions) => {
    const app = Fastify(opts);
    // A route's own method is one string; routes() answers a path's other methods as one array, with 405.
    app.addHook('onRoute', (r) => {
      if (typeof r.method === 'string' && r.method !== 'HEAD') registered.push(`${r.method} ${r.url}`);
    });
    return app;
  } };
});
const { serve } = await import('./fixtures/app.js');

/** `METHOD /path` with each parameter as `:`, and a file name's extension after one dropped (`:key.webp`). */
const shape = (route: string) => route.replace(/:\w+(?:\.\w+)?/g, ':');
const spec = readFileSync(new URL('../spec/http.md', import.meta.url), 'utf8');
const table = spec.slice(spec.indexOf('## HTTP API'), spec.indexOf('\n## ', spec.indexOf('## HTTP API') + 1));
const listed = [...table.matchAll(/^(GET|POST|PUT|DELETE|PATCH) +(\/api\/[^\s?[]+)/gm)]
  .map(([, method, url]) => shape(`${method} ${url}`));

const data = mkdtempSync(path.join(os.tmpdir(), 'spec-routes-'));
afterAll(() => rmSync(data, { recursive: true, force: true }));

test('the routes SPEC "HTTP API" lists are the routes the server has', async () => {
  const app = await serve({ dataDir: data });
  await app.close();
  const served = registered.filter((r) => r.includes(' /api/')).map(shape);
  assert.ok(listed.length > 20, `the route table: ${listed.length} routes`);
  assert.deepEqual(listed.filter((r) => !served.includes(r)), [], 'listed, but the server has none');
  assert.deepEqual(served.filter((r) => !listed.includes(r)), [], 'the server has it, but SPEC "HTTP API" lists none');
  assert.equal(new Set(listed).size, listed.length, 'each route listed once');
});
