#!/usr/bin/env node
// Folly Studio lint: size budgets, hygiene, syntax, safety and architecture. Node built-ins only.
//
//   node tools/lint.mjs [dir]      one `path:line rule message` per error; exit 1 if there are any
//   node tools/lint.mjs --rules    the rules, one line each
//
// One line can be silenced by a comment that starts with the marker, on the line or alone on the
// line above:  `lint-allow <rule>: <reason>`. File-level rules (sizes, syntax, deps) cannot be.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { areaOf, BUDGET_FILE, checkBudget } from './lint/budget.mjs';
import { blank, jsRanges, lineIndex, markupRanges, ranges } from './lint/scan.mjs';

const STUDIO = fileURLToPath(new URL('..', import.meta.url));
const KB = 1024;
export const LIMITS = {
  source: 400, test: 600, pattern: 150, // lines: code, test/**, public/patterns/*.js (they are AI examples)
  bytes: 64 * KB,                       // any text file
  lineLength: 120,                      // code (js, css, html, py)
  bundle: 150 * KB,                     // gzip -9 (static.js's level) of public/js/**/*.js + public/css/*.css
  login: 40 * KB,                       // index.html, what it loads, and the sign-in view
};
const DATA_CAPS = { 'public/data/cathedral.json': 1024 * KB }; // generated, committed data
const LOGIN_VIEW = 'public/js/ui/auth.js'; // main.js imports it at once for a signed-out visitor
const SKIP = /^(?:test\/fixtures\/lint\/|data\/)|(?:^|\/)(?:node_modules|\.git)\//;
// Paths that exist only at run time, and their source: the boxes find these next to their script
// (bound or copied in by the host; the core bundled by src/assets.js).
const BOX_FILES = {
  'pattern-core.js': 'public/js/pattern-core.js', 'fseq.js': 'public/js/fseq.js', 'frames.js': 'src/frames.js',
  'cathedral.json': 'public/data/cathedral.json', 'renderer.mjs': 'render-box/renderer.mjs',
};
const ALIASES = new Map(['render-box', 'fleet-box'].flatMap((box) => Object.entries(BOX_FILES)
  .map(([n, to]) => [`${box}/${n}`, to])));

// Reviewed exceptions to the capability rules, each with its reason. test/ is outside these rules.
const ALLOW = {
  'no-eval': {
    'public/js/core/compile.js': 'the pattern compiler: it only runs in the sandbox\'s worker or a box',
    'render-box/render.mjs': 'the render box: a stdlib-only node:vm realm inside bubblewrap',
    'tools/lint.mjs': 'parses modules with vm.SourceTextModule in a child process; never runs them',
  },
  'no-child-process': {
    'src/render-box.js': 'starts the render box under bubblewrap',
    'src/generate/fleet.js': 'drives the fleet CLI for boxed workers',
    'tools/lint.mjs': 'git ls-files and the batched syntax checks',
  },
};

export const RULES = {
  'max-lines': 'source ≤ 400 lines, tests ≤ 600, library patterns ≤ 150; markdown exempt',
  'max-bytes': 'text files ≤ 64 KB; listed generated data has its own cap',
  'max-line-length': 'code lines ≤ 120 characters',
  'bundle-size': 'gzipped public/js + public/css ≤ 150 KB; login page path ≤ 40 KB',
  'line-budget': 'each area\'s lines of code within tools/lint/budget.json; raising one needs a new reason',
  'final-newline': 'text files end with a newline',
  'trailing-space': 'no trailing whitespace',
  'no-tabs': 'no tabs in js, css or html',
  'no-crlf': 'LF line endings',
  'no-bom': 'no byte-order mark',
  'json': '.json files parse',
  'syntax': 'js/mjs pass node --check; py compiles',
  'no-eval': 'eval, Function and node:vm only in the pattern compiler and the render box',
  'no-child-process': 'child_process only in src/render-box.js and src/generate/fleet.js',
  'no-html-sink': 'no innerHTML, outerHTML, insertAdjacentHTML or document.write in public/js',
  'no-remote-url': 'no remote script, style or import URLs in public/',
  'no-console-log': 'no console.log in src/ or public/js/',
  'no-debugger': 'no debugger statements',
  'no-only': 'no focused tests',
  'no-secret': 'no API keys or private keys',
  'no-random': 'no Math.random in pattern-core.js, the render box or library patterns',
  'import-resolve': 'relative imports resolve to files; built-ins as node:x; no packages',
  'import-boundary': 'public/ imports only public/; src/ only pattern-core.js, fseq.js and data from it',
  'no-deps': 'no dependencies of any kind in package.json',
  'lint-allow': 'a silence names a known line rule and a reason, and is used',
};
const UNSILENCEABLE = new Set(['max-lines', 'max-bytes', 'bundle-size', 'line-budget', 'final-newline', 'no-bom',
  'json', 'syntax', 'no-deps', 'lint-allow']);

const URL_START = String.raw`(?:https?:)?\/\/`;
const REMOTE = new RegExp([
  String.raw`<(?:script|iframe)\b[^>]*?\bsrc\s*=\s*["']?`,
  String.raw`<link\b[^>]*?\bhref\s*=\s*["']?`,
  String.raw`(?:@import\s+|\burl\(\s*)["']?`,
  String.raw`(?:\bfrom|\bimport\s*\(?|\bimportScripts\s*\()\s*["'\x60]`,
].map((s) => s + URL_START).join('|'), 'gi');
const SECRET = /\bsk-ant-[\w-]{16,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;
const shipped = (...kinds) => (f) => kinds.includes(f.kind) && !f.test;
const under = (...dirs) => (f) => dirs.some((d) => f.rel.startsWith(d));
const deterministic = (f) => f.pattern || f.rel === 'public/js/pattern-core.js' || f.rel.startsWith('public/js/core/')
  || f.rel.startsWith('render-box/');
// [rule, files, pattern, message, view]: the `code` view blanks comments and literals, `text` only comments.
const PATTERNS = [
  ['no-eval', shipped('js', 'html'), /\beval\s*\(|\bFunction\s*\(/g, 'runtime code generation', 'code'],
  ['no-eval', shipped('js'), /["'](?:node:)?vm["']/g, 'node:vm', 'text'],
  ['no-child-process', shipped('js'), /["'](?:node:)?child_process["']/g, 'child_process', 'text'],
  ['no-html-sink', under('public/js/'), /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|\bdocument\.write(?:ln)?\b/g,
    'HTML string sink: build nodes and set textContent', 'text'],
  ['no-remote-url', (f) => f.code && f.rel.startsWith('public/'), REMOTE,
    'remote URL: the app runs offline under a self-only CSP', 'text'],
  ['no-console-log', under('src/', 'public/js/'), /\bconsole\.log\b/g,
    'console.log: use the logger, console.warn or console.error', 'code'],
  ['no-debugger', (f) => f.kind === 'js' || f.kind === 'html', /\bdebugger\b/g, 'debugger statement', 'code'],
  ['no-only', (f) => f.test && f.kind === 'js', /\.only\s*\(|\bonly\s*:\s*true\b/g,
    'focused test: the rest of the suite would not run', 'code'],
  ['no-secret', () => true, SECRET, 'secret-looking string: keys come from the environment', 'raw'],
  ['no-random', deterministic, /\bMath\.random\b/g, 'Math.random: bakes must be deterministic (rand, hash, seed)',
    'code'],
];
const IMPORT = new RegExp(String.raw`\b(?:import|export)\s*(?:[\w$*{},\s]*?\bfrom\s*)?(["'])([^"'\n]+)\1`
  + String.raw`|\bimport\s*\(\s*(["'\x60])([^"'\x60\n]+)\3\s*\)`, 'g');
const HTML_REF = /<(?:script|link|img|iframe|source)\b[^>]*?\b(?:src|href)\s*=\s*["']?([^"'\s>]+)/gi;
const ALLOW_MARK = /(?:\/\/|\/\*|#|<!--)[ \t]*lint-allow\b/g;
const KINDS = { js: 'js', mjs: 'js', cjs: 'js', css: 'css', html: 'html', htm: 'html', py: 'py', md: 'md',
  json: 'json' };

const kb = (n) => `${(n / KB).toFixed(1)} KB`;

function classify(rel) {
  const kind = KINDS[path.extname(rel).slice(1).toLowerCase()] || 'text';
  return { rel, kind, code: ['js', 'css', 'html', 'py'].includes(kind), test: rel.startsWith('test/'),
    pattern: /^public\/patterns\/[^/]+\.js$/.test(rel) };
}

/** Tracked and untracked-but-not-ignored files under root (a plain walk outside git), as posix paths. */
function listFiles(root) {
  let rels;
  try {
    rels = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch {
    rels = [];
    const walk = (dir) => {
      for (const d of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${d.name}` : d.name;
        if (d.isDirectory()) { if (!SKIP.test(`${rel}/`)) walk(rel); } else if (d.isFile()) rels.push(rel);
      }
    };
    walk('');
  }
  return [...new Set(rels)].filter((r) => !SKIP.test(r) && existsSync(path.join(root, r))).sort();
}

/** The comment-blanked (`text`) and comment-and-literal-blanked (`code`) views of a file. */
function views(f, src) {
  let comments, literals = [];
  if (f.kind === 'js') ({ comments, literals } = jsRanges(src));
  else if (f.kind === 'html') ({ comments, literals } = markupRanges(src));
  else if (f.kind === 'css') comments = ranges(src, /\/\*[\s\S]*?\*\//g);
  else if (f.kind === 'py') comments = ranges(src, /#[^\n]*/g);
  else return { text: src, code: src };
  return { text: blank(src, comments), code: blank(src, [...comments, ...literals].sort((a, b) => a[0] - b[0])) };
}

/** Where an import or a page reference lands: { target } and/or { error }. */
function resolve(f, spec, known, root) {
  if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(spec) && !spec.startsWith('node:')) return {}; // URLs: no-remote-url
  if (spec.includes('${')) return {}; // computed
  if (isBuiltin(spec)) return spec.startsWith('node:') ? {} : { error: `write 'node:${spec}'` };
  if (spec.startsWith('node:')) return { error: `no built-in '${spec}'` };
  if (!/^\.{0,2}\//.test(spec)) return { error: `package '${spec}': Folly Studio has no dependencies` };
  const clean = spec.replace(/[?#].*$/, '');
  let target = clean.startsWith('/') ? `public${clean}` : path.posix.join(path.posix.dirname(f.rel), clean);
  if (!known.has(target) && ALIASES.has(target)) target = ALIASES.get(target);
  const found = known.has(target) || (target.startsWith('../') && existsSync(path.join(root, target)));
  return found ? { target } : { target, error: `'${spec}' does not resolve to a file` };
}

function boundary(f, target) {
  if (f.rel.startsWith('public/') && !target.startsWith('public/')) return 'public/ imports only from public/';
  const server = f.rel.startsWith('src/') || f.rel === 'server.js';
  const shared = ['public/js/pattern-core.js', 'public/js/fseq.js'].includes(target) || target.endsWith('.json');
  if (server && target.startsWith('public/') && !shared) return 'src/ imports only pattern-core.js, fseq.js and data';
  return null;
}

/** Every check that needs only this file. Pushes { line, rule, message }; returns the file's import graph edges. */
function checkFile(f, src, ctx, report) {
  const lineAt = lineIndex(src);
  const lines = src.split('\n');
  const count = lines.length - (src.endsWith('\n') ? 1 : 0);
  const limit = !f.code ? 0 : f.pattern ? ctx.limits.pattern : f.test ? ctx.limits.test : ctx.limits.source;
  if (limit && count > limit) report(limit + 1, 'max-lines', `${count} lines > ${limit}: split it by responsibility`);
  if (src.charCodeAt(0) === 0xfeff) report(1, 'no-bom', 'byte-order mark');
  if (src && !src.endsWith('\n')) report(count, 'final-newline', 'no newline at the end of the file');
  const tabs = ['js', 'css', 'html'].includes(f.kind);
  let crlf = 0;
  lines.forEach((l, i) => {
    if (l.endsWith('\r')) { if (!crlf++) report(i + 1, 'no-crlf', 'CRLF line ending'); l = l.slice(0, -1); }
    const last = l.charCodeAt(l.length - 1);
    if (last === 32 || last === 9) report(i + 1, 'trailing-space', 'trailing whitespace');
    if (tabs && l.includes('\t')) report(i + 1, 'no-tabs', 'tab: indent with spaces');
    if (f.code && l.length > ctx.limits.lineLength && [...l].length > ctx.limits.lineLength) {
      report(i + 1, 'max-line-length', `${[...l].length} characters > ${ctx.limits.lineLength}`);
    }
  });
  if (f.kind === 'json') {
    try {
      const json = JSON.parse(src);
      if (path.posix.basename(f.rel) === 'package.json') {
        for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies',
          'bundleDependencies', 'bundledDependencies']) {
          if (k in json && !['{}', '[]'].includes(JSON.stringify(json[k]))) {
            report(lineAt(src.indexOf(`"${k}"`)), 'no-deps', `${k}: Folly Studio uses Node built-ins only`);
          }
        }
      }
    } catch (e) {
      const at = /line (\d+)/.exec(e.message)?.[1] || lineAt(+(/position (\d+)/.exec(e.message)?.[1] || 0));
      report(+at, 'json', e.message.replace(/ in JSON at position.*$/, ''));
    }
  }
  const v = views(f, src);
  for (const [rule, applies, re, message, view] of PATTERNS) {
    if (!applies(f) || ALLOW[rule]?.[f.rel]) continue;
    for (const m of (view === 'raw' ? src : v[view]).matchAll(re)) report(lineAt(m.index), rule, message);
  }
  const edges = [];
  const link = (spec, at, eager) => {
    const r = resolve(f, spec, ctx.known, ctx.root);
    if (r.error) report(lineAt(at), 'import-resolve', r.error);
    const crossing = r.target && boundary(f, r.target);
    if (crossing) report(lineAt(at), 'import-boundary', `'${spec}' is ${r.target}: ${crossing}`);
    if (r.target && eager) edges.push(r.target);
  };
  if (f.kind === 'js') {
    for (const m of v.text.matchAll(IMPORT)) if (v.code[m.index] !== ' ') link(m[2] || m[4], m.index, !!m[2]);
  } else if (f.kind === 'html') {
    for (const m of v.code.matchAll(HTML_REF)) link(m[1], m.index, true);
  }
  return { edges, count, allows: f.code ? allowsIn(src, v, lineAt) : [] };
}

/** `lint-allow <rule>: <reason>` comments: { line, target, rule?, reason? }. */
function allowsIn(src, v, lineAt) {
  const out = [];
  for (const m of src.matchAll(ALLOW_MARK)) {
    if (v.text[m.index] !== ' ') continue; // inside code or a string, not a comment
    const start = m.index + m[0].length, eol = src.indexOf('\n', start);
    const rest = src.slice(start, eol < 0 ? src.length : eol).replace(/\s*(?:\*\/|-->)\s*$/, '');
    const form = /^\s+([\w-]+)\s*:\s*(\S.*)$/.exec(rest);
    const before = v.code.slice(src.lastIndexOf('\n', m.index) + 1, m.index);
    const line = lineAt(m.index);
    out.push({ line, target: before.trim() ? line : line + 1, rule: form?.[1], reason: form?.[2] });
  }
  return out;
}

/** Drops errors a valid allow covers; reports malformed and unused allows. Returns the silences used. */
function applyAllows(allows, errors, report) {
  let used = 0;
  for (const a of allows) {
    if (!a.rule) { report(a.line, 'lint-allow', 'write `lint-allow <rule>: <reason>`'); continue; }
    if (!RULES[a.rule]) { report(a.line, 'lint-allow', `unknown rule ${a.rule}`); continue; }
    if (UNSILENCEABLE.has(a.rule)) { report(a.line, 'lint-allow', `${a.rule} cannot be silenced`); continue; }
    const before = errors.length;
    for (let i = errors.length - 1; i >= 0; i--) {
      if (errors[i].line === a.target && errors[i].rule === a.rule) errors.splice(i, 1);
    }
    if (errors.length < before) used++;
    else report(a.line, 'lint-allow', `unused lint-allow ${a.rule}`);
  }
  return used;
}

// One child parses every module (vm.SourceTextModule parses without linking or running anything);
// only files it rejects pay for a `node --check`, which names the line. Python: compile(), no .pyc.
const PARSE = `import vm from 'node:vm'; import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(1)) {
  try { new vm.SourceTextModule(readFileSync(f, 'utf8'), { identifier: f }); } catch { console.log(f); }
}`;
const PY_COMPILE = `import sys
for f in sys.argv[1:]:
    try: compile(open(f, 'rb').read(), f, 'exec')
    except Exception as e: print(f, getattr(e, 'lineno', None) or 1, getattr(e, 'msg', None) or e, sep='\\t')`;

async function checkSyntax(root, rels, notes) {
  const run = (cmd, args) => new Promise((done) => {
    execFile(cmd, args, { cwd: root, maxBuffer: 1 << 24 }, (error, stdout, stderr) => done({ error, stdout, stderr }));
  });
  const js = rels.filter((r) => classify(r).kind === 'js'), py = rels.filter((r) => r.endsWith('.py'));
  const node = process.execPath;
  const [mods, pys] = await Promise.all([
    js.length && run(node, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e', PARSE, ...js]),
    py.length && run('python3', ['-c', PY_COMPILE, ...py]),
  ]);
  const errors = [];
  const rejected = !mods ? [] : mods.error ? js : mods.stdout.split('\n').filter(Boolean);
  await Promise.all(rejected.map(async (file) => {
    const r = await run(node, ['--check', file]);
    if (!r.error) return;
    const message = /^\w*Error: .*$/m.exec(r.stderr)?.[0] || r.stderr.trim().split('\n').pop();
    errors.push({ file, line: +(/:(\d+)\r?\n/.exec(r.stderr)?.[1] || 1), rule: 'syntax', message });
  }));
  if (pys?.error) notes.push(`python3 ${pys.error.code === 'ENOENT' ? 'not found' : 'failed'}: .py files not compiled`);
  for (const l of pys ? pys.stdout.split('\n').filter(Boolean) : []) {
    const [file, line, message] = l.split('\t');
    errors.push({ file, line: +line, rule: 'syntax', message });
  }
  return errors;
}

/**
 * A file as it was before the change under review: HEAD's copy, or when the working copy is HEAD's
 * (CI, after the commit) its parent's; '' outside git, or when it is new.
 */
function committed(root, rel, text) {
  const show = (rev) => {
    try {
      const opts = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
      return execFileSync('git', ['show', `${rev}:./${rel}`], opts);
    } catch {
      return '';
    }
  };
  const head = show('HEAD');
  return head === text ? show('HEAD~1') : head;
}

/**
 * Lints a studio tree. Returns { errors: [{ file, line, rule, message }], silenced, files,
 * bundle: { total, login, loginFiles }, areas: Map<area, lines of code>, notes }.
 */
export async function lint({ root = STUDIO, limits = {} } = {}) {
  const ctx = { root, limits: { ...LIMITS, ...limits }, known: new Set(listFiles(root)) };
  const notes = [];
  const syntax = checkSyntax(root, [...ctx.known], notes);
  const errors = [], graph = new Map(), gz = new Map(), areas = new Map();
  let silenced = 0;
  for (const rel of ctx.known) {
    const buf = readFileSync(path.join(root, rel));
    if (buf.includes(0)) continue; // binary
    const f = classify(rel), seen = new Set(), mine = [];
    const report = (line, rule, message) => { // one error per rule per line
      const key = `${line} ${rule}`;
      if (!seen.has(key)) { seen.add(key); mine.push({ file: rel, line, rule, message }); }
    };
    const cap = DATA_CAPS[rel] || ctx.limits.bytes;
    if (buf.length > cap) report(1, 'max-bytes', `${kb(buf.length)} > ${kb(cap)}`);
    if (/^public\/.*\.(?:js|css|html)$/.test(rel)) gz.set(rel, gzipSync(buf, { level: 9 }).length);
    const { edges, allows, count } = checkFile(f, buf.toString('utf8'), ctx, report);
    graph.set(rel, edges);
    if (f.code) areas.set(areaOf(rel), (areas.get(areaOf(rel)) || 0) + count);
    silenced += applyAllows(allows, mine, report);
    errors.push(...mine);
  }
  const bundle = measureBundle(gz, graph, ctx, errors);
  const budget = ctx.known.has(BUDGET_FILE) ? readFileSync(path.join(root, BUDGET_FILE), 'utf8') : '';
  const report = (line, message) => errors.push({ file: BUDGET_FILE, line, rule: 'line-budget', message });
  notes.push(...checkBudget(budget, committed(root, BUDGET_FILE, budget), areas, report));
  errors.push(...await syntax);
  errors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { errors, silenced, files: ctx.known.size, bundle, areas, notes };
}

function measureBundle(gz, graph, ctx, errors) {
  let total = 0;
  for (const [rel, n] of gz) if (/^public\/(?:js\/.*\.js|(?:css\/)?[^/]+\.css)$/.test(rel)) total += n;
  const loginFiles = new Set(), todo = ['public/index.html', LOGIN_VIEW];
  while (todo.length) {
    const rel = todo.pop();
    if (loginFiles.has(rel) || !gz.has(rel)) continue;
    loginFiles.add(rel);
    todo.push(...(graph.get(rel) || []));
  }
  const login = [...loginFiles].reduce((sum, rel) => sum + gz.get(rel), 0);
  const L = ctx.limits, err = (file, message) => errors.push({ file, line: 1, rule: 'bundle-size', message });
  if (total > L.bundle) err('public/js', `public/js + css are ${kb(total)} gzipped > ${kb(L.bundle)}`);
  if (login > L.login) err('public/index.html', `the login page loads ${kb(login)} gzipped > ${kb(L.login)}`);
  if (gz.has('public/index.html') && !gz.has(LOGIN_VIEW)) err('public/index.html', `no ${LOGIN_VIEW}: fix LOGIN_VIEW`);
  return { total, login, loginFiles: [...loginFiles].sort() };
}

async function main() {
  const arg = process.argv[2];
  if (arg === '--rules') {
    for (const [rule, text] of Object.entries(RULES)) console.log(`${rule.padEnd(17)} ${text}`);
    return;
  }
  const r = await lint({ root: arg ? path.resolve(arg) : STUDIO });
  for (const e of r.errors) console.log(`${e.file}:${e.line} ${e.rule} ${e.message}`);
  for (const n of r.notes) console.log(`lint: ${n}`);
  const { total, login } = r.bundle;
  console.log(`bundle: public js+css ${kb(total)} gz (budget ${kb(LIMITS.bundle)}), `
    + `login page ${kb(login)} gz (budget ${kb(LIMITS.login)})`);
  const files = new Set(r.errors.map((e) => e.file)).size;
  console.log(`lint: ${r.errors.length} errors in ${files} files, ${r.files} files checked, `
    + `${r.silenced} silenced, ${process.uptime().toFixed(2)} s`);
  process.exitCode = r.errors.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
