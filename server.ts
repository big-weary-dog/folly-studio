#!/usr/bin/env node
// Folly Studio server: environment → createServer() (src/app.ts), serving the app from dist/ (`npm run build`).
//
//   PORT                   default 8780
//   HOST                   default 127.0.0.1
//   STUDIO_DATA            data dir, default studio/data/
//   STUDIO_CURATORS        comma-separated usernames with the curator role
//   STUDIO_ADMINS          comma-separated usernames with the admin role (the Models panel; curators too)
//   STUDIO_SECURE_COOKIES  1 → Secure session cookie (serve over https)
//   STUDIO_MODELS          the model registry, default <STUDIO_DATA>/models.json (docs/HOSTING.md)
//   STUDIO_GENERATOR       superseded by the registry: the default it starts with (claude, sketch or fleet)
//   STUDIO_GENERATOR_FALLBACK  a model or transport foundry ideas go to while it is off or busy (none: they fail
//                          while it is off, wait while busy)
//   STUDIO_FOUNDRY         on → fleet runs, one job at a time; STUDIO_FOUNDRY_WAIT=1 → while busy, wait anyway
//   STUDIO_TRUST_PROXY     1 → one proxy in front (a tunnel): client IP and host from what it forwards
//   STUDIO_BAKE_SECONDS    longest render-box bake, default 120 (also STUDIO_BAKE_TIMEOUT, _CPU, _NICE (10),
//                          _TASKS, _MEMORY, _MAX_FRAMES: see src/render-box.ts; needs bubblewrap)
//   STUDIO_FRAMES_BROTLI_QUALITY  baked frames' brotli quality for streaming, default 9 (11: ~12 % smaller,
//                          ~13× the CPU)
//   STUDIO_FRAMES_MAX_BYTES       disk cap for baked frames, default 2GB (least recently used go first)
//   STUDIO_IDEA_LOGS       how many ideas' logs to keep (<STUDIO_DATA>/ideas-log), default 300; 0 → none written
//   STUDIO_IDEA_LOGS_MAX_BYTES  their disk cap, default 500MB (the oldest go first)
//   STUDIO_FLASH_PER_SECOND, _DELTA, _AREA  the flash check's limits (3, 0.5, 0.25); STUDIO_FLASH_CHECK=off
//                          stops it blocking review or dimming previews (local use only, never a public server)
//   PI_PREVIEW_URL         a dry-run Studio Live on this machine (http://127.0.0.1:4043, started with --base /pi),
//                          shown to admins at /pi (docs/HOSTING.md "The Pi's page")

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './src/app.ts';
import { parseBytes } from './src/bake.ts';
import { flashSettings } from './src/box-output.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const on = (v?: string) => v === '1' || v === 'true';
const port = Number(env.PORT || 8780);
const host = env.HOST || '127.0.0.1';
const dataDir = path.resolve(env.STUDIO_DATA || path.join(here, 'data'));

const app = await createServer({ dataDir, publicDir: path.join(here, 'public'), distDir: path.join(here, 'dist'),
  curators: env.STUDIO_CURATORS || '', admins: env.STUDIO_ADMINS || '', secureCookies: on(env.STUDIO_SECURE_COOKIES),
  generatorName: env.STUDIO_GENERATOR || '',
  trustProxy: on(env.STUDIO_TRUST_PROXY), framesQuality: Number(env.STUDIO_FRAMES_BROTLI_QUALITY) || undefined,
  framesMaxBytes: parseBytes(env.STUDIO_FRAMES_MAX_BYTES, undefined), flash: flashSettings(env),
  piPreview: env.PI_PREVIEW_URL || undefined, ideaLogs: { keep: env.STUDIO_IDEA_LOGS ? Number(env.STUDIO_IDEA_LOGS)
    : undefined, maxBytes: parseBytes(env.STUDIO_IDEA_LOGS_MAX_BYTES, undefined) } });
const addr = await app.listen(port, host);
const where = `http://${host.includes(':') ? `[${host}]` : host}:${addr.port}/`;
console.log(`[studio] Folly Studio on ${where} (data ${dataDir}, models ${app.models.file}, default `
  + `${app.adapterName})`);
if (!flashSettings(env).check) console.warn('[studio] STUDIO_FLASH_CHECK=off: flashing blocks nothing (local only)');

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
