// The app as Vite builds it into dist/ (`npm run build`), served by @fastify/static under the security headers, and
// the loaders for the pattern library and the rig (from public/). Vite names every file under assets/ by its
// content, so those are kept for a year; the shell (index.html, for every SPA route) revalidates on every load and
// names the current ones. The build precompresses text (.br and .gz beside each file: tools/vite-compress.ts).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { LibraryEntry, Rig, type Rig as RigType, type RigGroup } from '../shared/schemas/rig.ts';
import { problem } from '../shared/schemas/look.ts';
import { HttpError, type Log } from './http.ts';

export const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
export const DEFAULT_DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url));

// worker-src blob: lets the sandbox run patterns in a Worker made from a Blob (see sandbox.html);
// the worker inherits this policy, so it has no network either.
export const CSP_APP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; "
  + "base-uri 'none'; frame-ancestors 'none'";
export const CSP_SANDBOX = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; "
  + 'sandbox allow-scripts';
export const CACHE_PAGE = 'no-cache';
export const CACHE_ASSET = 'public, max-age=300, must-revalidate';
// The URL names the content (its hash), so a copy never goes stale.
export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const SANDBOX_PAGE = /^assets\/sandbox-[\w-]+\.html$/; // the sandbox page (tools/vite-sandbox.ts)

/** serveApp(app, { distDir, log }): dist/ at /, the shell for SPA routes, 404 and 405 for the rest. */
export async function serveApp(app: FastifyInstance, { distDir = DEFAULT_DIST_DIR, log }: { distDir?: string,
  log: Log }) {
  const root = path.resolve(distDir);
  const shell = path.join(root, 'index.html');
  await app.register(fastifyStatic, {
    root, preCompressed: true, dotfiles: 'ignore', cacheControl: false, suppressWarning: true,
    setHeaders(reply, file) {
      const rel = path.relative(root, file).replace(/\.(?:br|gz)$/, '').split(path.sep).join('/');
      reply.header('cache-control', rel.startsWith('assets/') ? CACHE_IMMUTABLE
        : rel.endsWith('.html') ? CACHE_PAGE : CACHE_ASSET);
      if (SANDBOX_PAGE.test(rel)) reply.header('content-security-policy', CSP_SANDBOX);
    },
  });
  // JavaScript's media type is text/javascript (RFC 9239), not the mime package's older name; a 304 has no body to
  // be encoded.
  app.addHook('onSend', async (req, reply) => {
    if (reply.statusCode === 304) reply.removeHeader('content-encoding');
    if (/^application\/javascript\b/.test(String(reply.getHeader('content-type')))) {
      reply.header('content-type', 'text/javascript; charset=utf-8');
    }
  });
  let warned = false;
  app.setNotFoundHandler(async (req, reply) => {
    let pathname = req.url.split('?')[0]!;
    try { pathname = decodeURIComponent(pathname); } catch { throw new HttpError(404, 'Not found.'); }
    if (/^\/api(?:\/|$)/.test(pathname)) {
      throw new HttpError(404, 'No such API route.', { 'Cache-Control': 'no-store' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    }
    // SPA routes (/studio, /ideas/abc, …) get the app shell; dotfiles (.vite/, .env) nothing.
    if (!path.extname(pathname) && !/\/\./.test(pathname) && existsSync(shell)) return reply.sendFile('index.html');
    if (!warned && !existsSync(shell)) {
      warned = true;
      log.warn?.(`static: ${shell} is missing: run npm run build`);
    }
    throw new HttpError(404, 'Not found.');
  });
}

// Loaders shared with the generator: synchronous, re-read only when their files change.
const statSig = (file: string) => {
  try { const st = statSync(file); return st.isFile() ? `${st.size}:${st.mtimeMs}` : '-'; } catch { return '-'; }
};
function readJson(file: string, log: Log) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    const { code, message } = err as NodeJS.ErrnoException;
    if (code !== 'ENOENT') log.warn?.(`static: cannot read ${file}: ${message}`);
    return null;
  }
}

/** fn(), recomputed only when the stats of files() change; callers get copies. */
function memo<T>(files: () => string[], fn: () => T) {
  let sig: string | null = null, value: T;
  return (): T => {
    const s = files().map(statSig).join('|');
    if (s !== sig) [sig, value] = [s, fn()];
    return structuredClone(value);
  };
}

// The library's index.json, bad and duplicate names dropped.
const Index = z.array(z.unknown()).catch([]).transform((list) => {
  const seen = new Set<string>();
  return list.flatMap((e) => LibraryEntry.safeParse(e).data ?? []).filter((e) => !seen.has(e.name) && seen.add(e.name));
});

// createLoaders(publicDir) → { loadLibrary() → [{ name, title, summary, tags, kind, category, code, … }],
//   loadRig() → rig.json as SPEC "Rig" has it (null until it exists), loadGroups() → its `groups` }
export function createLoaders(publicDir = DEFAULT_PUBLIC_DIR, { log }: { log: Log }) {
  const libDir = path.join(publicDir, 'patterns');
  const indexFile = path.join(libDir, 'index.json');
  const rigFile = path.join(publicDir, 'data', 'rig.json');
  const index = memo(() => [indexFile], () => Index.parse(readJson(indexFile, log)));
  const codeFile = (e: { name: string }) => path.join(libDir, `${e.name}.js`);
  const loadLibrary = memo(() => [indexFile, ...index().map(codeFile)], () => index().flatMap((e) => {
    try { return [{ ...e, code: readFileSync(codeFile(e), 'utf8') }]; } catch { return []; } // listed, no file
  }));
  const loadRig = memo(() => [rigFile], () => {
    const json = readJson(rigFile, log);
    const rig = json && Rig.safeParse(json);
    if (rig && !rig.success) log.warn?.(`static: ${rigFile} is not a rig (SPEC "Rig"): ${problem(rig.error)}`);
    return rig?.success ? json as RigType : null;
  });
  const loadGroups = (): RigGroup[] => loadRig()?.groups ?? [];
  return { loadLibrary, loadRig, loadGroups };
}
