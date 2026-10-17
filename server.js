#!/usr/bin/env node
// Folly Studio server: environment → createServer() (src/app.js).
//
//   PORT                   default 8780
//   HOST                   default 127.0.0.1
//   STUDIO_DATA            data dir, default studio/data/
//   STUDIO_CURATORS        comma-separated usernames with the curator role
//   STUDIO_SECURE_COOKIES  1 → Secure session cookie (serve over https)
//   STUDIO_GENERATOR       idea generator adapter: sketch (default) | claude | fleet (deep ideas, below)
//   STUDIO_FOUNDRY         on → fleet runs, one job at a time; else deep ideas go to STUDIO_GENERATOR_FALLBACK
//                          (default sketch); STUDIO_FOUNDRY_WAIT=1 → they wait for the foundry instead
//   STUDIO_TRUST_PROXY     1 → client IP / host from X-Forwarded-For / X-Forwarded-Host
//   STUDIO_BAKE_SECONDS    longest render-box bake, default 120 (also STUDIO_BAKE_TIMEOUT, _CPU, _NICE (10),
//                          _TASKS, _MEMORY, _MAX_FRAMES: see src/render-box.js; needs bubblewrap)
//   STUDIO_FRAMES_BROTLI_QUALITY  baked frames' brotli quality for streaming, default 9 (11: ~12 % smaller,
//                          ~13× the CPU)
//   STUDIO_FRAMES_MAX_BYTES       disk cap for baked frames, default 2GB (least recently used go first)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './src/app.js';
import { parseBytes } from './src/bake.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const on = (v) => v === '1' || v === 'true';
const port = Number(env.PORT || 8780);
const host = env.HOST || '127.0.0.1';
const dataDir = path.resolve(env.STUDIO_DATA || path.join(here, 'data'));

const app = await createServer({ dataDir, publicDir: path.join(here, 'public'), curators: env.STUDIO_CURATORS || '',
  secureCookies: on(env.STUDIO_SECURE_COOKIES), generatorName: env.STUDIO_GENERATOR || 'sketch',
  trustProxy: on(env.STUDIO_TRUST_PROXY), framesQuality: Number(env.STUDIO_FRAMES_BROTLI_QUALITY) || undefined,
  framesMaxBytes: parseBytes(env.STUDIO_FRAMES_MAX_BYTES, undefined) });
const addr = await app.listen(port, host);
const where = `http://${host.includes(':') ? `[${host}]` : host}:${addr.port}/`;
console.log(`[studio] Folly Studio on ${where} (data ${dataDir}, generator ${app.adapterName})`);

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`[studio] ${signal}: saving and shutting down`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      console.error('[studio] shutdown failed:', err);
      process.exit(1);
    }
  });
}
