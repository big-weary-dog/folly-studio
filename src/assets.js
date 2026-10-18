// Content-addressed URLs for the app's static files (SPEC "Static files"), so a browser keeps them for a
// year and a repeat visit sends nothing for them. Built in memory, rebuilt when a file changes; no build step.
//   /js/**.js        → /js/<name>.<hash>.js, found through an import map the shell carries inline (its
//                      CSP hash goes in the shell's header), so module imports and import() stay as written
//   /css/*.css       → one /css/theme.<hash>.css: the shell's stylesheets in their order, then the views'
//   /data/*.json, /favicon.svg, /sandbox.html (core inlined) → <name>.<hash>.<ext>
// Modules' quoted literals naming these ('/css/ideas.css', '/data/rig.json', '/sandbox.html') and the
// shell's href/src are rewritten to the hashed URLs. Plain URLs still serve the files as they are.

import { createHash } from 'node:crypto';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';


export const CORE_MARKER = '/*@CORE@*/';
export const THEME_URL = '/css/theme.css';
const HASH_LENGTH = 10;
const HASHED = new RegExp(`^(.+)\\.[0-9a-f]{${HASH_LENGTH}}(\\.[a-z0-9]+)$`);
const LITERAL = /'(\/(?:css|data)\/[A-Za-z0-9_.\/-]+|\/sandbox\.html)'/g;
const STYLESHEET = /<link rel="stylesheet" href="(\/css\/[^"]+\.css)">\n?/g;
const sha = (body, enc = 'hex') => createHash('sha256').update(body).digest(enc);
const hashed = (url, body) => url.replace(/(\.[a-z0-9]+)$/, `.${sha(body).slice(0, HASH_LENGTH)}$1`);
const statSig = (st) => (st ? `${st.size}:${st.mtimeMs}` : '-');

// An ES module and what it imports as one script, for what cannot load modules: the sandbox's worker (a Blob at an
// opaque origin) and the boxes. Dependencies come first; relative import and re-export lines go, `export` keywords
// stay, so the result is still a module of its own.
const FROM = /^(?:import|export)\b[^;]*?\bfrom\s*'(\.{1,2}\/[^']+)';[ \t]*\n?/gm;

/** bundle(file) → { text, files }; `files` (every module read) lets a caller cache on them. */
export function bundle(file) {
  const files = [];
  const parts = [];
  const visit = (f) => {
    if (files.includes(f)) return;
    files.push(f);
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(FROM)) visit(path.resolve(path.dirname(f), m[1]));
    parts.push(text.replace(FROM, ''));
  };
  visit(path.resolve(file));
  return { text: parts.join('\n'), files };
}

/** The URL a hashed one names (/js/main.0123456789.js → /js/main.js), or null. */
export function unhashed(url) {
  const m = HASHED.exec(url);
  return m ? m[1] + m[2] : null;
}

/** sandbox.html with its worker and the core inlined → { body, files } (`files`: what it was built from). */
export async function buildSandbox(root) {
  const worker = bundle(path.join(root, 'js', 'sandbox-worker.js'));
  // Keep the inlined script from closing the <script> element early.
  const core = worker.text.replace(/<\/(script)/gi, '<\\/$1');
  const html = await fsp.readFile(path.join(root, 'sandbox.html'), 'utf8');
  return { body: Buffer.from(html.split(CORE_MARKER).join(core), 'utf8'), files: worker.files };
}

async function walk(dir, ext) {
  const entries = await fsp.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries.filter((e) => e.isFile() && e.name.endsWith(ext) && !e.name.startsWith('.'))
    .map((e) => path.join(e.parentPath ?? e.path, e.name)).sort();
}

/**
 * createAssets({ root, recheckMs = 1000, log }) → { current() → manifest | null }. The manifest:
 *   { byUrl: Map(hashed URL → { url, type, body }), urlOf(plain URL) → hashed URL | undefined,
 *     shell(html) → { body, scriptHash? } }. Rebuilt when a file's size or mtime changes, looked at no more
 * than once per `recheckMs`.
 */
export function createAssets({ root, recheckMs = 1000, log = console }) {
  let built = null, sig = null, checkedAt = 0, pending = null;
  const urlOf = (file) => `/${path.relative(root, file).split(path.sep).join('/')}`;

  async function inputs() {
    const [js, css, data] = await Promise.all([walk(path.join(root, 'js'), '.js'), walk(path.join(root, 'css'), '.css'),
      walk(path.join(root, 'data'), '.json')]);
    // The sandbox's worker and core are modules under js/, so their changes show up here too.
    const top = ['index.html', 'sandbox.html', 'favicon.svg'].map((f) => path.join(root, f));
    const files = [...js, ...css, ...data, ...top];
    const stats = await Promise.all(files.map((f) => fsp.stat(f).catch(() => null)));
    return { js, css, data, sig: files.map((f, i) => `${f}=${statSig(stats[i])}`).join('|') };
  }

  async function build({ js, css, data }) {
    const read = (f) => fsp.readFile(f).catch(() => null);
    const byUrl = new Map(), plain = new Map();
    const add = (url, type, body) => {
      const h = hashed(url, body);
      byUrl.set(h, { url, type, body });
      plain.set(url, h);
      return h;
    };
    for (const f of [...data, path.join(root, 'favicon.svg')]) {
      const body = await read(f);
      if (body) add(urlOf(f), f.endsWith('.svg') ? 'image/svg+xml' : 'application/json; charset=utf-8', body);
    }
    // The theme: the shell's stylesheets in their order, then the rest (each view's) by name.
    const shellHtml = String(await read(path.join(root, 'index.html')) ?? '');
    const linked = [...shellHtml.matchAll(STYLESHEET)].map((m) => m[1]);
    const order = [...linked.filter((u) => css.includes(path.join(root, u))), ...css.map(urlOf)
      .filter((u) => !linked.includes(u))];
    const sheets = await Promise.all(order.map((url) => read(path.join(root, url))));
    const theme = Buffer.from(order.map((url, i) => `/* ${url} */\n${sheets[i] ?? ''}`).join('\n'));
    const themeUrl = add(THEME_URL, 'text/css; charset=utf-8', theme);
    for (const url of order) plain.set(url, themeUrl);
    try {
      add('/sandbox.html', 'text/html; charset=utf-8', (await buildSandbox(root)).body);
    } catch (err) {
      log.warn?.(`assets: the sandbox cannot be built: ${err.message}`);
    }
    const rewrite = (text) => text.replace(LITERAL, (m, url) => (plain.has(url) ? `'${plain.get(url)}'` : m));
    const imports = {};
    for (const f of js) {
      const text = await read(f);
      if (text) imports[urlOf(f)] = add(urlOf(f), 'text/javascript; charset=utf-8', Buffer.from(rewrite(String(text))));
    }
    const importMap = JSON.stringify({ imports }).replace(/</g, '\\u003c'); // never ends its <script>
    return {
      byUrl, urlOf: (url) => plain.get(url),
      /** The app shell with hashed URLs, one theme stylesheet and the import map before its first module. */
      shell(html) {
        let first = true;
        let body = html.replace(STYLESHEET, (m, url) => {
          if (plain.get(url) !== themeUrl) return m;
          if (!first) return '';
          first = false;
          return `<link rel="stylesheet" href="${themeUrl}">\n`;
        }).replace(/\b(href|src)="(\/[^"]+)"/g, (m, attr, url) => (plain.has(url) ? `${attr}="${plain.get(url)}"` : m));
        const at = body.indexOf('<script type="module"');
        if (at < 0) return { body };
        body = `${body.slice(0, at)}<script type="importmap">${importMap}</script>\n${body.slice(at)}`;
        return { body, scriptHash: `sha256-${sha(importMap, 'base64')}` };
      },
    };
  }

  async function refresh() {
    const now = Date.now();
    if (built && now - checkedAt < recheckMs) return built;
    checkedAt = now;
    const found = await inputs();
    if (built && found.sig === sig) return built;
    built = await build(found);
    sig = found.sig;
    return built;
  }

  return {
    /** The manifest, rebuilt if anything changed; concurrent callers share one rebuild. */
    current() {
      pending ||= refresh().catch((err) => {
        log.error?.(`assets: cannot hash the static files: ${err.message}`);
        return built;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}
