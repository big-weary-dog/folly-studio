// `npm run lint` on small trees: tools/budgets.mjs (sizes, hygiene, silences, the line ratchet), and the safety rules
// and allowlist in .oxlintrc.jsonc, each firing where it should and nowhere else.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, test } from 'vitest';

import { check, checkBudget } from '../tools/budgets.mjs';

const STUDIO = fileURLToPath(new URL('..', import.meta.url));
const OFF = `// ${'oxlint'}-disable-next-line`; // spelled apart, so budgets.mjs does not read this file's own as one
const json70k = `${JSON.stringify({ pad: 'x'.repeat(70 * 1024) })}\n`;
const roots = [];
afterAll(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A git work tree (budgets.mjs lists files with git) holding these files. */
function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'studio-lint-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

test('budgets.mjs: sizes, hygiene, remote URLs, secrets, silences and the ratchet', () => {
  const root = tree({
    'tools/budgets.json': `${JSON.stringify({ areas: { src: { lines: 10 }, public: { lines: 1 },
      'public/css': { lines: 500 } } }, null, 1)}\n`,
    'src/crlf.js': 'export const a = 1;\r\nexport const b = 2;\r\n',
    'src/bom.js': '\uFEFFexport const a = 1;\n',
    'src/spaces.js': 'export const a = 1; \n',
    'src/no-newline.js': 'export const a = 1;',
    'src/tabs.js': 'export function f() {\n\treturn 1;\n}\n',
    'src/wide.js': `// ${'x'.repeat(118)}\n// ${'\u{1F308}'.repeat(117)}\n`, // characters, not UTF-16 units
    'src/keys.js': `export const k = '${['sk', 'ant', 'a'.repeat(24)].join('-')}';\n`,
    'src/silences.js': [`${OFF} no-console`, 'console.info(1);', `${OFF} no-console -- the logger`, 'console.info(2);',
      `${OFF} max-lines -- long`, `/* ${'oxlint'}-disable no-eval */`, ''].join('\n'),
    'src/long.js': '// filler\n'.repeat(401), // oxlint's max-lines
    'public/css/long.css': 'a {}\n'.repeat(401),
    'public/index.html': '<script src="https://cdn.example.com/x.js"></script>\n',
    'public/data/rig.json': json70k,
    'public/data/big.json': json70k,
    'broken.json': '{ "a": 1,\n}\n',
    'NOTES.md': `${'word '.repeat(40)}end\n`,
  });
  const r = check(root);
  assert.deepEqual(r.errors.map((e) => `${e.file}:${e.line} ${e.rule}`), [
    'broken.json:1 json', 'public/css/long.css:401 max-lines', 'public/data/big.json:1 max-bytes',
    'public/index.html:1 no-remote-url', 'src/bom.js:1 no-bom', 'src/crlf.js:1 no-crlf', 'src/keys.js:1 no-secret',
    'src/no-newline.js:1 final-newline', 'src/silences.js:1 silence', 'src/silences.js:5 silence',
    'src/silences.js:6 silence', 'src/spaces.js:1 trailing-space', 'src/tabs.js:2 no-tabs',
    'src/wide.js:1 max-line-length', 'tools/budgets.json:3 line-budget',
  ]);
  assert.match(r.errors.at(-1).message, /^src has 418 lines, over its budget of 10/);
  assert.deepEqual(r.notes, ['public/css is at 401 of 500 lines: lower its budget']);
  const cli = spawnSync(process.execPath, [path.join(STUDIO, 'tools/budgets.mjs'), root], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.equal(cli.stdout.split('\n').filter((l) => /^\S+:\d+ [a-z-]+ \S/.test(l)).length, r.errors.length);
  assert.match(cli.stdout, /^budgets: 15 errors, 16 files checked, [\d.]+ s$/m);
});

test('.oxlintrc.jsonc: the safety rules, the import boundaries and the allowlist', () => {
  const root = tree({
    'src/server.js': ["import vm from 'node:vm';", "import { spawn } from 'node:child_process';",
      "import { h } from '../public/js/ui/dom.js';", "import { run } from '../public/js/pattern-core.js';",
      "import rig from '../public/data/rig.json' with { type: 'json' };", 'console.warn(vm, spawn, h, run, rig);',
      "console.log(eval('1'), new Function('')); debugger;", ''].join('\n'),
    'src/render-box.js': "import { spawn } from 'node:child_process';\nconsole.warn(spawn);\n",
    'src/typed.ts': 'export const t = (x: string): unknown => eval(x);\n',
    'public/js/ui/view.js': ["import { app } from '../../../src/app.js';",
      "import x from 'https://cdn.example.com/x.js';",
      'export const s = (el) => { el.innerHTML = app; document.write(x); return Math.random(); };', ''].join('\n'),
    'public/js/core/scene.js': 'export const r = () => Math.random();\n',
    'public/js/core/compile.js': 'export const make = (s) => new Function(s);\n',
    'public/patterns/long.js': `${'// filler\n'.repeat(150)}const params = {};\n`
      + 'function pixel(p, t) { return [Math.random()]; }\n',
    'render-box/render.mjs': "import vm from 'node:vm';\nconsole.warn(vm);\n",
    'tools/t.mjs': ["import vm from 'node:vm';", "import { execFile } from 'node:child_process';",
      'console.log(vm, execFile);', ''].join('\n'),
    'test/t.test.js': "import vm from 'node:vm';\nconsole.log(vm, eval('1'));\n",
  });
  copyFileSync(path.join(STUDIO, '.oxlintrc.jsonc'), path.join(root, '.oxlintrc.jsonc'));
  const r = spawnSync(path.join(STUDIO, 'node_modules/.bin/oxlint'), ['-f', 'unix'], { cwd: root, encoding: 'utf8' });
  const found = [...r.stdout.matchAll(/^(\S+):(\d+):\d+: .*\((\S+)\)\]$/gm)]
    .map(([, file, line, rule]) => `${file}:${line} ${rule}`).sort();
  assert.deepEqual(found, [
    'public/js/core/scene.js:1 no-restricted-properties', 'public/js/ui/view.js:1 no-restricted-imports',
    'public/js/ui/view.js:2 no-restricted-imports', 'public/js/ui/view.js:3 no-restricted-properties',
    'public/js/ui/view.js:3 no-restricted-properties', 'public/patterns/long.js:152 max-lines',
    'public/patterns/long.js:152 no-restricted-properties', 'src/server.js:1 no-restricted-imports',
    'src/server.js:2 no-restricted-imports', 'src/server.js:3 no-restricted-imports', 'src/server.js:7 no-console',
    'src/server.js:7 no-debugger', 'src/server.js:7 no-eval', 'src/server.js:7 no-new-func', 'src/typed.ts:1 no-eval',
  ], r.stdout);
  assert.equal(r.status, 1);
});

test('a budget goes up only with a new reason, and its file stays', () => {
  const run = (now, was, lines = 12) => {
    const out = [];
    checkBudget(now && JSON.stringify({ areas: { src: now } }), JSON.stringify({ areas: { src: was } }),
      new Map([['src', lines]]), (line, message) => out.push(message));
    return out;
  };
  assert.deepEqual(run({ lines: 12 }, { lines: 12 }), []);
  assert.match(run({ lines: 12 }, { lines: 10 })[0], /went up from 10 without a new reason/);
  assert.match(run({ lines: 12, reason: 'r' }, { lines: 10, reason: 'r' })[0], /without a new reason/);
  assert.deepEqual(run({ lines: 12, reason: 'the bake panel' }, { lines: 10 }), []);
  assert.match(run({ lines: 11, reason: 'r' }, { lines: 10 })[0], /over its budget of 11/);
  assert.match(run(null, { lines: 10 })[0], /committed budget is gone/);
});
