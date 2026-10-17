// Static files from public/, the sandbox page with the pattern core inlined, the
// security headers every response carries, and the loaders for the pattern library
// and the cathedral's groups (shared with the generator).
//
// Lightweight serving: text bodies are compressed once (brotli or gzip, whichever the client
// takes) and kept in memory until the file's mtime or size changes; every response has an ETag
// and `If-None-Match` answers 304. HTML and the sandbox revalidate on every load (no-cache);
// everything else may be reused for a few minutes, then revalidates.

import { createHash } from 'node:crypto';
import { promises as fsp, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

export const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

export const CSP_APP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
// worker-src blob: lets the sandbox run patterns in a Worker made from a Blob (see sandbox.html);
// the worker inherits this policy, so it has no network either.
export const CSP_SANDBOX = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; sandbox allow-scripts";
export const CORE_MARKER = '/*@CORE@*/';

/** Cache-Control for pages (always revalidate) and for everything else (reuse briefly, then revalidate). */
export const CACHE_PAGE = 'no-cache';
export const CACHE_ASSET = 'public, max-age=300, must-revalidate';

// Browser copies of pure ES modules that live in src/ (no Node APIs in them).
const ALIASES = new Map([['/js/frames.js', fileURLToPath(new URL('./frames.js', import.meta.url))]]);

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|manifest\+json)|image\/svg\+xml)/;
const MIN_COMPRESS = 512;              // smaller bodies are not worth an encoding
const MAX_CACHED = 4 * 1024 * 1024;    // bigger files are read per request and sent as they are
const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);
const ENCODERS = {
  br: (body) => brotli(body, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
  } }),
  gzip: (body) => gzip(body, { level: 9 }),
};

/** Headers on every response (the sandbox page swaps the CSP for its own). */
export function applySecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP_APP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
}

/** Does an Accept-Encoding header take this encoding (q=0 means no; `*` covers the rest)? */
export function acceptsEncoding(header, name) {
  let star = 0;
  for (const part of String(header || '').toLowerCase().split(',')) {
    const [token, ...params] = part.split(';').map((x) => x.trim());
    if (!token) continue;
    const qp = params.find((x) => x.startsWith('q='));
    const q = qp ? Number(qp.slice(2)) : 1;
    const v = Number.isFinite(q) ? q : 0;
    if (token === name) return v > 0;
    if (token === '*') star = v;
  }
  return star > 0;
}

/** The best encoding the request accepts: 'br', then 'gzip', else null. */
export function pickEncoding(header) {
  if (acceptsEncoding(header, 'br')) return 'br';
  if (acceptsEncoding(header, 'gzip')) return 'gzip';
  return null;
}

/** Does an If-None-Match header match this ETag (weak comparison, lists and `*`)? */
export function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const bare = (t) => t.trim().replace(/^W\//, '');
  return header.split(',').some((t) => bare(t) === bare(etag));
}

function sendText(req, res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(req.method === 'HEAD' ? undefined : text);
}

async function statFile(file) {
  try {
    const st = await fsp.stat(file);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

const statSig = (st) => `${st.size}:${st.mtimeMs}`;

/** createStatic({ publicDir }) → async (req, res, pathname) handling GET/HEAD for non-/api paths. */
export function createStatic({ publicDir = DEFAULT_PUBLIC_DIR, log = console } = {}) {
  const root = path.resolve(publicDir);
  // key → { sig, type, body, etag, compressible, br?: Promise<Buffer>, gzip?: Promise<Buffer> }
  const cache = new Map();

  async function entry(key, sig, type, load) {
    const hit = cache.get(key);
    if (hit && hit.sig === sig) return hit;
    const body = await load();
    const e = {
      sig, type, body,
      etag: `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
      compressible: COMPRESSIBLE.test(type) && body.length >= MIN_COMPRESS,
    };
    if (body.length <= MAX_CACHED) cache.set(key, e);
    else cache.delete(key);
    return e;
  }

  async function encoded(e, enc) {
    if (!e[enc]) e[enc] = ENCODERS[enc](e.body);
    try {
      const out = await e[enc];
      return out.length < e.body.length ? out : null;
    } catch (err) {
      e[enc] = null;
      (log.warn ?? console.warn)(`static: ${enc} failed: ${err.message}`);
      return null;
    }
  }

  async function send(req, res, e, cacheControl, extra = {}) {
    const headers = { 'Content-Type': e.type, 'Cache-Control': cacheControl, ETag: e.etag, ...extra };
    if (e.compressible) headers.Vary = 'Accept-Encoding';
    if (etagMatches(req.headers['if-none-match'], e.etag)) {
      res.writeHead(304, headers);
      return res.end();
    }
    let body = e.body;
    const enc = e.compressible ? pickEncoding(req.headers['accept-encoding']) : null;
    const packed = enc ? await encoded(e, enc) : null;
    if (packed) {
      body = packed;
      headers['Content-Encoding'] = enc;
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function sendFile(req, res, file, st) {
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const e = await entry(file, statSig(st), type, () => fsp.readFile(file));
    const page = type.startsWith('text/html');
    return send(req, res, e, page ? CACHE_PAGE : CACHE_ASSET, { 'Last-Modified': st.mtime.toUTCString() });
  }

  async function sendSandbox(req, res) {
    const htmlFile = path.join(root, 'sandbox.html');
    const coreFile = path.join(root, 'js', 'pattern-core.js');
    const [hst, cst] = await Promise.all([statFile(htmlFile), statFile(coreFile)]);
    if (!hst) return sendText(req, res, 404, 'Not found');
    if (!cst) {
      (log.error ?? console.error)('static: public/js/pattern-core.js is missing; the sandbox cannot run patterns');
      return sendText(req, res, 500, 'pattern-core.js is missing');
    }
    const e = await entry(':sandbox', `${statSig(hst)}|${statSig(cst)}`, 'text/html; charset=utf-8', async () => {
      const [html, raw] = await Promise.all([fsp.readFile(htmlFile, 'utf8'), fsp.readFile(coreFile, 'utf8')]);
      // Keep the inlined core from closing the <script> element early.
      const core = raw.replace(/<\/(script)/gi, '<\\/$1');
      return Buffer.from(html.split(CORE_MARKER).join(core), 'utf8');
    });
    return send(req, res, e, CACHE_PAGE, { 'Content-Security-Policy': CSP_SANDBOX });
  }

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return sendText(req, res, 400, 'Bad request');
    }
    if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) {
      return sendText(req, res, 404, 'Not found');
    }
    if (decoded === '/sandbox.html') return sendSandbox(req, res);
    if (ALIASES.has(decoded)) {
      const file = ALIASES.get(decoded);
      const st = await statFile(file);
      if (st) return sendFile(req, res, file, st);
    }

    const segments = decoded.split('/').filter(Boolean);
    // No `..`, no `.`, no dotfiles (.git, .env, …).
    if (segments.some((s) => s.startsWith('.'))) return sendText(req, res, 404, 'Not found');

    const indexFile = path.join(root, 'index.html');
    const file = segments.length ? path.resolve(root, ...segments) : indexFile;
    if (file !== indexFile && !file.startsWith(root + path.sep)) return sendText(req, res, 404, 'Not found');

    const st = await statFile(file);
    if (st) return sendFile(req, res, file, st);

    // SPA routes (/studio, /ideas/abc, …) get the app shell.
    const last = segments[segments.length - 1] ?? '';
    if (!path.extname(last)) {
      const ist = await statFile(indexFile);
      if (ist) return sendFile(req, res, indexFile, ist);
    }
    return sendText(req, res, 404, 'Not found');
  };
}

// ---------------------------------------------------------------------------
// Loaders shared with the generator. Synchronous (so they work with or without
// `await`), cached on file mtimes/sizes, and tolerant of the files not existing yet.

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function statSync_(file) {
  try {
    const st = statSync(file);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

const sig = (st) => (st ? `${st.mtimeMs}:${st.size}` : '-');

function parseIndex(data) {
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (Array.isArray(data?.patterns)) list = data.patterns;
  else if (data && typeof data === 'object') list = Object.entries(data).map(([name, v]) => ({ ...(v && typeof v === 'object' ? v : {}), name }));
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const e = typeof raw === 'string' ? { name: raw } : raw && typeof raw === 'object' ? raw : null;
    const name = e && (e.name ?? e.id);
    if (typeof name !== 'string' || !NAME_RE.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({
      ...e,
      name,
      title: typeof e.title === 'string' && e.title ? e.title : name,
      summary: typeof e.summary === 'string' ? e.summary : '',
      tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string') : [],
    });
  }
  return out;
}

/**
 * createLoaders(publicDir) → {
 *   loadLibrary() → [{ name, title, summary, tags, code, ...other index.json fields }]
 *   loadGroups()  → cathedral.json `groups` array ([] until it exists)
 * }
 */
export function createLoaders(publicDir = DEFAULT_PUBLIC_DIR, { log = console } = {}) {
  const libDir = path.join(publicDir, 'patterns');
  const indexFile = path.join(libDir, 'index.json');
  const cathedralFile = path.join(publicDir, 'data', 'cathedral.json');
  let indexCache = { sig: null, entries: [] };
  let libCache = { sig: null, value: [] };
  let groupCache = { sig: null, value: [] };

  function loadLibrary() {
    const ist = statSync_(indexFile);
    if (!ist) return [];
    if (indexCache.sig !== sig(ist)) {
      let entries = [];
      try {
        entries = parseIndex(JSON.parse(readFileSync(indexFile, 'utf8')));
      } catch (err) {
        (log.warn ?? console.warn)(`library: cannot read ${indexFile}: ${err.message}`);
      }
      indexCache = { sig: sig(ist), entries };
    }
    const files = indexCache.entries.map((e) => path.join(libDir, `${e.name}.js`));
    const stats = files.map(statSync_);
    const key = `${indexCache.sig}|${stats.map(sig).join('|')}`;
    if (libCache.sig !== key) {
      const value = [];
      indexCache.entries.forEach((e, i) => {
        if (!stats[i]) return;
        try {
          value.push({ ...e, code: readFileSync(files[i], 'utf8') });
        } catch {
          /* vanished between stat and read: skip */
        }
      });
      libCache = { sig: key, value };
    }
    return structuredClone(libCache.value);
  }

  function loadGroups() {
    const st = statSync_(cathedralFile);
    if (!st) return [];
    if (groupCache.sig !== sig(st)) {
      let value = [];
      try {
        const data = JSON.parse(readFileSync(cathedralFile, 'utf8'));
        if (Array.isArray(data?.groups)) value = data.groups;
      } catch (err) {
        (log.warn ?? console.warn)(`groups: cannot read ${cathedralFile}: ${err.message}`);
      }
      groupCache = { sig: sig(st), value };
    }
    return structuredClone(groupCache.value);
  }

  return { loadLibrary, loadGroups };
}

const loaderCache = new Map();
const loadersFor = (publicDir) => {
  const key = path.resolve(publicDir);
  if (!loaderCache.has(key)) loaderCache.set(key, createLoaders(key));
  return loaderCache.get(key);
};

/** loadLibrary(publicDir?) → [{ name, title, summary, tags, code }] */
export const loadLibrary = (publicDir = DEFAULT_PUBLIC_DIR) => loadersFor(publicDir).loadLibrary();
/** loadGroups(publicDir?) → cathedral groups array */
export const loadGroups = (publicDir = DEFAULT_PUBLIC_DIR) => loadersFor(publicDir).loadGroups();
