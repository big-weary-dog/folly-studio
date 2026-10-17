#!/usr/bin/env node
// Folly Studio server: environment → createServer() (src/api.js).
//
//   PORT                   default 8780
//   HOST                   default 127.0.0.1
//   STUDIO_DATA            data dir, default studio/data/
//   STUDIO_CURATORS        comma-separated usernames with the curator role
//   STUDIO_SECURE_COOKIES  1 → Secure session cookie (serve over https)
//   STUDIO_GENERATOR       idea generator adapter: sketch (default) | claude | fleet
//   STUDIO_TRUST_PROXY     1 → client IP / host from X-Forwarded-For / X-Forwarded-Host

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './src/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const on = (v) => v === '1' || v === 'true';

const port = Number(env.PORT || 8780);
const host = env.HOST || '127.0.0.1';
const dataDir = path.resolve(env.STUDIO_DATA || path.join(here, 'data'));

const app = await createServer({
  dataDir,
  publicDir: path.join(here, 'public'),
  curators: env.STUDIO_CURATORS || '',
  secureCookies: on(env.STUDIO_SECURE_COOKIES),
  generatorName: env.STUDIO_GENERATOR || 'sketch',
  trustProxy: on(env.STUDIO_TRUST_PROXY),
});
const addr = await app.listen(port, host);
console.log(`[studio] Folly Studio on http://${host.includes(':') ? `[${host}]` : host}:${addr.port}/ (data ${dataDir}, generator ${app.adapterName})`);

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
