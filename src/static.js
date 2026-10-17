// Static files from public/, the sandbox page with the pattern core inlined, the
// security headers every response carries, and the loaders for the pattern library
// and the cathedral's groups (shared with the generator).

import { promises as fsp, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

export const CSP_APP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
export const CSP_SANDBOX = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; sandbox allow-scripts";
export const CORE_MARKER = '/*@CORE@*/';

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

/** Headers on every response (the sandbox page swaps the CSP for its own). */
export function applySecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP_APP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
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

/** createStatic({ publicDir }) → async (req, res, pathname) handling GET/HEAD for non-/api paths. */
export function createStatic({ publicDir = DEFAULT_PUBLIC_DIR, log = console } = {}) {
  const root = path.resolve(publicDir);

  async function sendFile(req, res, file, st) {
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
      'Last-Modified': st.mtime.toUTCString(),
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    const data = await fsp.readFile(file);
    res.writeHead(200, { ...headers, 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  async function sendSandbox(req, res) {
    let html, core;
    try {
      html = await fsp.readFile(path.join(root, 'sandbox.html'), 'utf8');
    } catch {
      return sendText(req, res, 404, 'Not found');
    }
    try {
      core = await fsp.readFile(path.join(root, 'js', 'pattern-core.js'), 'utf8');
    } catch {
      (log.error ?? console.error)('static: public/js/pattern-core.js is missing; the sandbox cannot run patterns');
      return sendText(req, res, 500, 'pattern-core.js is missing');
    }
    // Keep the inlined core from closing the <script> element early.
    core = core.replace(/<\/(script)/gi, '<\\/$1');
    const body = Buffer.from(html.split(CORE_MARKER).join(core), 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP_SANDBOX,
      'Cache-Control': 'no-cache',
      'Content-Length': body.length,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
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
