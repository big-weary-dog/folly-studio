#!/usr/bin/env node
// Folly Studio server: the environment's settings (src/config.ts; every one in docs/HOSTING.md "Environment") →
// createServer() (src/app.ts), serving the app from dist/ (`npm run build`). A setting that does not parse stops it
// here, naming the variable (never its value).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './src/app.ts';
import { ConfigError, describeConfig, readConfig } from './src/config.ts';
import { DataLockedError } from './src/store-lock.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
let config;
try {
  config = readConfig(process.env, { log: console });
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(`[studio] not started; fix these settings (docs/HOSTING.md "Environment"):\n${err.message}`);
  process.exit(1);
}
console.log(`[studio] settings: ${describeConfig(config)}`);
const c = config;
const port = c.PORT ?? 8780;
const host = c.HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`[studio] not started: HOST=${host}: Studio listens on loopback only, behind its tunnel.`);
  process.exit(1);
}
const dataDir = path.resolve(c.STUDIO_DATA || path.join(here, 'data'));

const app = await createServer({ config: c, dataDir, publicDir: path.join(here, 'public'),
  distDir: path.join(here, 'dist'), curators: c.STUDIO_CURATORS || '', admins: c.STUDIO_ADMINS || '',
  secureCookies: c.STUDIO_SECURE_COOKIES ?? false,
  trustProxy: c.STUDIO_TRUST_PROXY ?? false, framesQuality: c.STUDIO_FRAMES_BROTLI_QUALITY || undefined,
  framesMaxBytes: c.STUDIO_FRAMES_MAX_BYTES }).catch((err) => {
  if (!(err instanceof DataLockedError)) throw err;
  console.error(`[studio] not started: ${err.message}`);
  process.exit(1);
});
const addr = await app.listen(port, host);
const where = `http://${host.includes(':') ? `[${host}]` : host}:${addr.port}/`;
console.log(`[studio] Folly Studio on ${where} (data ${dataDir})`);
if (c.STUDIO_FLASH_CHECK === false) {
  console.warn('[studio] STUDIO_FLASH_CHECK=off: flashing blocks nothing (local only)');
}

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

// A failed promise is one request's: log it and carry on. An uncaught exception leaves the process in a state
// nothing vouches for: save what it can within 10 s and exit 1, for systemd's Restart=on-failure to start it again.
process.on('unhandledRejection', (err) => console.error('[studio] unhandled rejection:', err));
process.on('uncaughtException', (err) => {
  console.error('[studio] uncaught exception, exiting:', err);
  if (stopping) process.exit(1);
  stopping = true;
  setTimeout(() => process.exit(1), 10_000).unref();
  app.close().catch((e) => console.error('[studio] shutdown failed:', e)).finally(() => process.exit(1));
});
