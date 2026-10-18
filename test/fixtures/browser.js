// A browser, as far as bytes on the wire go: an HTTP cache (max-age, immutable, no-cache, ETags), a page load
// that follows the shell's scripts and links, and for each module what Vite's manifest says it loads with it (the
// modules it imports, its styles and the files it fetches), the view module a route loads, and a clock to make
// cached copies stale.
import http from 'node:http';
import zlib from 'node:zlib';

/** GET (or another method) counting the bytes on the wire: status line, headers and the body as sent. */
export function request(port, url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const head = `HTTP/1.1 ${res.statusCode}\r\n\r\n`.length + res.rawHeaders.reduce((n, v) => n + v.length + 2, 0);
        const enc = res.headers['content-encoding'];
        const text = (enc === 'br' ? zlib.brotliDecompressSync(raw) : enc === 'gzip' ? zlib.gunzipSync(raw) : raw)
          .toString('utf8');
        resolve({ url, status: res.statusCode, headers: res.headers, wire: head + raw.length, bodyBytes: raw.length,
          text });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

const maxAge = (cc) => (/no-cache|no-store/.test(cc) ? 0 : Number(/max-age=(\d+)/.exec(cc)?.[1] || 0));

/**
 * browser(port, { encoding, cookie, manifest }) → { load(path, { view, api }), fetch(url, opts), tick(s), log, … };
 * `manifest`: the build's .vite/manifest.json, and a view is its key (js/ui/studio.tsx).
 */
export function browser(port, { encoding = 'br, gzip', cookie = '', manifest = {} } = {}) {
  const cache = new Map(); // url → { res, at }
  const b = { log: [], clock: 0, cookie };
  const byFile = new Map(Object.values(manifest).map((e) => [`/${e.file}`, e]));
  const send = (url, opts = {}) => request(port, url, { ...opts, headers: { 'accept-encoding': encoding,
    ...(b.cookie ? { cookie: b.cookie } : {}), ...opts.headers } });

  /** A GET through the cache: nothing sent while fresh (unless `main`, a navigation), else conditional. */
  b.fetch = async (url, { main = false } = {}) => {
    const hit = cache.get(url);
    if (hit && !main && b.clock - hit.at < maxAge(hit.res.headers['cache-control'] || '')) {
      b.log.push({ url, status: 'cache', wire: 0 });
      return hit.res;
    }
    const etag = hit?.res.headers.etag;
    const res = await send(url, { headers: etag ? { 'if-none-match': etag } : {} });
    b.log.push({ url, status: res.status, wire: res.wire });
    if (res.status === 304 && hit) {
      hit.at = b.clock;
      return { ...hit.res, status: 304 };
    }
    const store = res.status === 200 && !/no-store/.test(res.headers['cache-control'] || '');
    if (store) cache.set(url, { res, at: b.clock });
    return res;
  };
  /** A request that is not a cached GET (POST, PUT…). */
  b.call = async (method, url, body) => {
    const res = await send(url, { method, body: JSON.stringify(body ?? {}),
      headers: { 'content-type': 'application/json' } });
    b.log.push({ url: `${method} ${url}`, status: res.status, wire: res.wire });
    return res;
  };

  const loaded = new Set();
  /** A file, and for a module the modules, styles and files it loads with it. */
  async function file(url) {
    if (loaded.has(url)) return;
    loaded.add(url);
    await b.fetch(url);
    const e = byFile.get(url);
    for (const key of e?.imports || []) await file(`/${manifest[key].file}`);
    for (const f of [...e?.css || [], ...e?.assets || []]) await file(`/${f}`);
  }

  /** A navigation: the shell (if `shell`), then what it loads, the view module, `api` GETs. */
  b.load = async (path, { view, api = [], shell = true } = {}) => {
    if (shell) {
      loaded.clear();
      const { text } = await b.fetch(path, { main: true });
      for (const [, url] of text.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)="(\/[^"]+)"/g)) await file(url);
    }
    if (view) await file(`/${manifest[view].file}`);
    for (const url of api) await b.fetch(url);
  };
  b.tick = (seconds) => { b.clock += seconds; };
  /** The log since `from`: { responses, requests (sent), bytes }. */
  b.total = (from = 0) => {
    const part = b.log.slice(from);
    return { responses: part.length, requests: part.filter((r) => r.status !== 'cache').length,
      bytes: part.reduce((n, r) => n + r.wire, 0) };
  };
  return b;
}
