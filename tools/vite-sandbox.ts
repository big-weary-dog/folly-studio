// The sandbox page (SPEC "Sandbox protocol") as Vite builds it: public/sandbox.html with its Worker
// (js/sandbox-worker.ts and the pattern core) and its relay (js/sandbox-relay.ts) each built as one minified
// classic script and inlined, since the page's CSP (default-src 'none') lets it load nothing. A module imports it
// as '<path>/sandbox.html?sandbox' and gets its URL: in a build, a content-hashed asset; on the dev server,
// /sandbox.html, built afresh for each request.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { build, type Plugin, type Rollup } from 'vite';

import { CSP_SANDBOX } from '../src/static.ts';

const QUERY = '?sandbox';
const ID = '\0folly-sandbox:'; // `${ID}<template>.js`: the module whose default export is the page's URL
const MARKS = { worker: '/*@WORKER@*/', relay: '/*@RELAY@*/' };

/**
 * One module and what it imports as a minified classic script, safe inside a <script> element: an IIFE, so its names
 * stay in its own scope (it exports nothing, so the `name` Vite asks for makes no global).
 */
async function classicScript(entry: string) {
  const result = await build({
    configFile: false, logLevel: 'warn', publicDir: false, root: path.dirname(entry),
    build: { write: false, minify: true, emptyOutDir: false, copyPublicDir: false,
      lib: { entry, formats: ['iife'], name: 'folly', fileName: () => 'script.js' },
      rolldownOptions: { output: { intro: '"use strict";' } } }, // strict, as the modules it is made of are
  });
  const chunk = ([result].flat()[0] as Rollup.RollupOutput).output.find((o) => o.type === 'chunk')!;
  return chunk.code.replace(/<\/(script)/gi, '<\\/$1');
}

/** The sandbox page's HTML: the template at `file` with its two scripts inlined. */
export async function buildSandbox(file: string) {
  const js = path.join(path.dirname(file), 'js');
  const [html, worker, relay] = await Promise.all([readFile(file, 'utf8'),
    classicScript(path.join(js, 'sandbox-worker.ts')), classicScript(path.join(js, 'sandbox-relay.ts'))]);
  for (const mark of Object.values(MARKS)) if (!html.includes(mark)) throw new Error(`${file} has no ${mark}`);
  return html.replace(MARKS.worker, () => worker).replace(MARKS.relay, () => relay);
}

/** The Vite plugin: `?sandbox` imports, and /sandbox.html on the dev server. */
export function sandboxPage(): Plugin {
  let command = 'build';
  return {
    name: 'folly-sandbox',
    enforce: 'pre', // before Vite's own resolver takes the path and its query
    configResolved(config) { command = config.command; },
    resolveId(source, importer) {
      if (!source.endsWith(QUERY) || !importer) return null;
      return `${ID}${path.resolve(path.dirname(importer), source.slice(0, -QUERY.length))}.js`;
    },
    async load(id) {
      if (!id.startsWith(ID)) return null;
      if (command === 'serve') return "export default '/sandbox.html';";
      const source = await buildSandbox(id.slice(ID.length, -'.js'.length));
      const ref = this.emitFile({ type: 'asset', name: 'sandbox.html', source });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/sandbox.html') return next();
        buildSandbox(path.join(server.config.root, 'sandbox.html')).then((html) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache',
            'Content-Security-Policy': CSP_SANDBOX });
          res.end(html);
        }, next);
      });
    },
  };
}
