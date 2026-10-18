// Static files from public/, the sandbox page with its worker inlined, the security headers, and the
// loaders for the pattern library and the rig. Text bodies are compressed once (br or gzip)
// and kept until the file changes; ETags answer 304. The shell revalidates every load and names the
// content-hashed URLs of src/assets.js, which are kept for a year; plain URLs are reused for 5 minutes.

import { createHash } from 'node:crypto';
import { promises as fsp, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

import { buildSandbox, createAssets, unhashed } from './assets.js';

export const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

// worker-src blob: lets the sandbox run patterns in a Worker made from a Blob (see sandbox.html);
// the worker inherits this policy, so it has no network either.
export const CSP_APP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; "
  + "base-uri 'none'; frame-ancestors 'none'";
export const CSP_SANDBOX = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; "
  + 'sandbox allow-scripts';
export { CORE_MARKER } from './assets.js';
export const CACHE_PAGE = 'no-cache';
export const CACHE_ASSET = 'public, max-age=300, must-revalidate';
// The URL names the content (its hash), so a copy never goes stale.
export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const UTF8 = '; charset=utf-8';
export const MIME = {
  '.html': `text/html${UTF8}`, '.js': `text/javascript${UTF8}`, '.mjs': `text/javascript${UTF8}`,
  '.css': `text/css${UTF8}`, '.json': `application/json${UTF8}`, '.txt': `text/plain${UTF8}`, '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const COMPRESSIBLE = /^(?:text\/|application\/json|image\/svg\+xml)/;
const MIN_COMPRESS = 512;              // smaller bodies are not worth an encoding
const MAX_CACHED = 4 * 1024 * 1024;    // bigger files are read per request and sent as they are
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const Z = zlib.constants;
const ENCODERS = {
  br: (body) => brotli(body, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_TEXT,
    [Z.BROTLI_PARAM_SIZE_HINT]: body.length } }),
  gzip: (body) => gzip(body, { level: 9 }),
};

/** The app's CSP with an inline script's hash allowed (the shell's import map). */
export const cspWithScript = (hash) => CSP_APP.replace("script-src 'self'", `script-src 'self' '${hash}'`);

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
    const q = Number(params.find((x) => x.startsWith('q='))?.slice(2) ?? 1) || 0;
    if (token === name) return q > 0;
    if (token === '*') star = q;
  }
  return star > 0;
}

/** The best encoding the request accepts: 'br', then 'gzip', else null. */
export function pickEncoding(header) {
  return acceptsEncoding(header, 'br') ? 'br' : acceptsEncoding(header, 'gzip') ? 'gzip' : null;
}

/** Does an If-None-Match header match this ETag (weak comparison, lists and `*`)? */
export function etagMatches(header, etag) {
  if (!header) return false;
  const bare = (t) => t.trim().replace(/^W\//, '');
  return header.trim() === '*' || header.split(',').some((t) => bare(t) === bare(etag));
}

/** A weak ETag for a body. */
export const etagOf = (body) => `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`;

function sendText(req, res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(req.method === 'HEAD' ? undefined : text);
}

const statFile = (file) => fsp.stat(file).then((st) => (st.isFile() ? st : null), () => null);
const statSig = (st) => (st ? `${st.size}:${st.mtimeMs}` : '-');

/** createStatic({ publicDir, log, recheckMs }) → async (req, res, pathname) handling GET/HEAD for non-/api paths. */
export function createStatic({ publicDir = DEFAULT_PUBLIC_DIR, log = console, recheckMs } = {}) {
  const root = path.resolve(publicDir);
  const cache = new Map(); // key → { sig, type, body, etag, compressible, br?: Promise, gzip?: Promise }
  const assets = createAssets({ root, log, recheckMs });
  const hashedEntries = new WeakMap(); // manifest asset → its entry (bodies are compressed once per version)
  const shells = new WeakMap();        // manifest → { sig, e, csp }: the shell naming that version's URLs
  let sandboxFiles = [];   // the sandbox's last bundle: its cache depends on them

  const makeEntry = (sig, type, body) => ({ sig, type, body, etag: etagOf(body),
    compressible: COMPRESSIBLE.test(type) && body.length >= MIN_COMPRESS });
  async function entry(key, sig, type, load) {
    const hit = cache.get(key);
    if (hit && hit.sig === sig) return hit;
    const e = makeEntry(sig, type, await load());
    if (e.body.length <= MAX_CACHED) cache.set(key, e);
    else cache.delete(key);
    return e;
  }

  async function encoded(e, enc) {
    e[enc] ||= ENCODERS[enc](e.body);
    try {
      const out = await e[enc];
      return out.length < e.body.length ? out : null;
    } catch (err) {
      e[enc] = null;
      log.warn?.(`static: ${enc} failed: ${err.message}`);
      return null;
    }
  }

  async function send(req, res, e, cacheControl, extra = {}) {
    const headers = { 'Content-Type': e.type, 'Cache-Control': cacheControl, ETag: e.etag, ...extra };
    if (e.compressible) headers.Vary = 'Accept-Encoding';
    if (etagMatches(req.headers['if-none-match'], e.etag)) { res.writeHead(304, headers); return res.end(); }
    const enc = e.compressible ? pickEncoding(req.headers['accept-encoding']) : null;
    const packed = enc && await encoded(e, enc);
    if (packed) headers['Content-Encoding'] = enc;
    const body = packed || e.body;
    res.writeHead(200, { ...headers, 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function sendFile(req, res, file, st) {
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const e = await entry(file, statSig(st), type, () => fsp.readFile(file));
    return send(req, res, e, type.startsWith('text/html') ? CACHE_PAGE : CACHE_ASSET,
      { 'Last-Modified': st.mtime.toUTCString() });
  }

  /** The app shell, its URLs hashed; the CSP allows its import map. */
  async function sendShell(req, res, file, st) {
    const manifest = await assets.current();
    if (!manifest) return sendFile(req, res, file, st);
    let shell = shells.get(manifest);
    if (shell?.sig !== statSig(st)) {
      const { body, scriptHash } = manifest.shell(await fsp.readFile(file, 'utf8'));
      shell = { sig: statSig(st), e: makeEntry('', MIME['.html'], Buffer.from(body, 'utf8')),
        csp: scriptHash ? cspWithScript(scriptHash) : CSP_APP };
      shells.set(manifest, shell);
    }
    return send(req, res, shell.e, CACHE_PAGE, { 'Content-Security-Policy': shell.csp });
  }

  async function sendSandbox(req, res) {
    const htmlFile = path.join(root, 'sandbox.html');
    const files = [htmlFile, ...sandboxFiles];
    const stats = await Promise.all(files.map(statFile));
    if (!stats[0]) return sendText(req, res, 404, 'Not found');
    let e;
    try {
      e = await entry(':sandbox', stats.map(statSig).join('|'), 'text/html; charset=utf-8', async () => {
        const built = await buildSandbox(root);
        sandboxFiles = built.files;
        return built.body;
      });
    } catch (err) {
      log.error?.(`static: the sandbox's scripts cannot be read: ${err.message}`);
      return sendText(req, res, 500, 'The sandbox scripts are missing');
    }
    return send(req, res, e, CACHE_PAGE, { 'Content-Security-Policy': CSP_SANDBOX });
  }

  /** A content-hashed URL: kept for a year when it names the current version, else the current one, briefly. */
  async function sendHashed(req, res, url) {
    const manifest = await assets.current();
    const exact = manifest?.byUrl.get(url);
    const asset = exact ?? manifest?.byUrl.get(manifest.urlOf(unhashed(url)));
    if (!asset) return false;
    let e = hashedEntries.get(asset);
    if (!e) hashedEntries.set(asset, e = makeEntry('', asset.type, asset.body));
    const extra = asset.url === '/sandbox.html' ? { 'Content-Security-Policy': CSP_SANDBOX } : {};
    await send(req, res, e, exact ? CACHE_IMMUTABLE : CACHE_ASSET, extra);
    return true;
  }

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return sendText(req, res, 400, 'Bad request'); }
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
    if (unhashed(decoded) && await sendHashed(req, res, decoded)) return;
    const st = await statFile(file);
    if (st) return file === indexFile ? sendShell(req, res, file, st) : sendFile(req, res, file, st);
    // SPA routes (/studio, /ideas/abc, …) get the app shell.
    const ist = !path.extname(segments.at(-1) ?? '') && await statFile(indexFile);
    return ist ? sendShell(req, res, indexFile, ist) : sendText(req, res, 404, 'Not found');
  };
}

// Loaders shared with the generator: synchronous, re-read only when their files change.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const statSyncFile = (file) => {
  try { const st = statSync(file); return st.isFile() ? st : null; } catch { return null; }
};
const readJson = (file, log) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn?.(`static: cannot read ${file}: ${err.message}`);
    return null;
  }
};

/** fn(), recomputed only when the stats of files() change; callers get copies. */
function memo(files, fn) {
  let sig = null, value;
  return () => {
    const s = files().map((f) => statSig(statSyncFile(f))).join('|');
    if (s !== sig) [sig, value] = [s, fn()];
    return structuredClone(value);
  };
}

/** The library's index.json: [{ name, title, summary, tags, … }], bad and duplicate names dropped. */
function libraryIndex(data) {
  const seen = new Set();
  return (Array.isArray(data) ? data : [])
    .filter((e) => e && NAME_RE.test(e.name) && !seen.has(e.name) && seen.add(e.name))
    .map((e) => ({
      ...e,
      title: typeof e.title === 'string' && e.title ? e.title : e.name,
      summary: typeof e.summary === 'string' ? e.summary : '',
      tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string') : [],
    }));
}

// createLoaders(publicDir) → { loadLibrary() → [{ name, title, summary, tags, code, …index.json fields }],
//   loadRig() → rig.json (null until it exists), loadGroups() → its `groups` ([] until it exists) }
export function createLoaders(publicDir = DEFAULT_PUBLIC_DIR, { log = console } = {}) {
  const libDir = path.join(publicDir, 'patterns');
  const indexFile = path.join(libDir, 'index.json');
  const rigFile = path.join(publicDir, 'data', 'rig.json');
  const index = memo(() => [indexFile], () => libraryIndex(readJson(indexFile, log)));
  const codeFile = (e) => path.join(libDir, `${e.name}.js`);
  const loadLibrary = memo(() => [indexFile, ...index().map(codeFile)], () => index().flatMap((e) => {
    try { return [{ ...e, code: readFileSync(codeFile(e), 'utf8') }]; } catch { return []; } // listed, no file
  }));
  const loadRig = memo(() => [rigFile], () => readJson(rigFile, log) || null);
  const loadGroups = () => (Array.isArray(loadRig()?.groups) ? loadRig().groups : []);
  return { loadLibrary, loadRig, loadGroups };
}
