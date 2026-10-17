// tools/lint.mjs on fixtures: each rule fires where it should and nowhere else.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lint, RULES } from '../tools/lint.mjs';
import { checkBudget } from '../tools/lint/budget.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/lint/', import.meta.url));
const LINT = fileURLToPath(new URL('../tools/lint.mjs', import.meta.url));
const filler = (n) => '// filler\n'.repeat(n);
const json70k = `${JSON.stringify({ pad: 'x'.repeat(70 * 1024) })}\n`;
// Written at test time: bytes an editor or a secret scanner would "fix", and files too big to commit.
const GENERATED = {
  'src/crlf.js': 'export const a = 1;\r\nexport const b = 2;\r\n',
  'src/bom.js': '﻿export const a = 1;\n',
  'src/spaces.js': 'export const a = 1; \n',
  'src/no-newline.js': 'export const a = 1;',
  'public/js/tabs.js': 'export function f() {\n\treturn 1;\n}\n',
  'tools/tabs.py': 'def f():\n\treturn 1\n',
  'src/big.js': `${filler(400)}export {};\n`,
  'test/big.js': filler(601),
  'public/patterns/long.js': `${filler(150)}function pixel() { return [0, 0, 0]; }\n`,
  'NOTES.md': `# Notes\n${`${'word '.repeat(29)}word\n`.repeat(500)}`,
  'public/data/cathedral.json': json70k,
  'public/data/big.json': json70k,
  'src/keys.js': [
    `export const a = '${'sk-' + 'ant-' + 'a'.repeat(24)}';`,
    `export const b = '${'AK' + 'IA' + 'Q'.repeat(16)}';`,
    `// -----BEGIN RSA ${'PRIV' + 'ATE'} KEY-----`,
    '',
  ].join('\n'),
};
// Every error the tree should produce, by rule, in lint's order (file, then line).
const EXPECT = {
  'max-lines': ['public/patterns/long.js:151', 'src/big.js:401', 'test/big.js:601'],
  'max-bytes': ['NOTES.md:1', 'public/data/big.json:1'],
  'max-line-length': ['public/js/main.js:24'],
  'bundle-size': ['public/index.html:1', 'public/js:1'],
  'final-newline': ['src/no-newline.js:1'],
  'trailing-space': ['src/spaces.js:1'],
  'no-tabs': ['public/js/tabs.js:2'],
  'no-crlf': ['src/crlf.js:1'],
  'no-bom': ['src/bom.js:1'],
  'json': ['broken.json:3'],
  'syntax': ['src/broken.js:3', 'tools/broken.py:2'],
  'no-eval': ['public/js/main.js:22', 'src/server.js:3', 'src/server.js:13'],
  'no-child-process': ['src/server.js:2'],
  'line-budget': ['tools/lint/budget.json:7'],
  'no-html-sink': ['public/js/main.js:8', 'public/js/main.js:9', 'public/js/main.js:21'],
  'no-remote-url': ['public/app.css:2', 'public/index.html:9', 'public/js/main.js:6'],
  'no-console-log': ['public/js/main.js:10', 'public/js/main.js:15', 'src/server.js:10'],
  'no-debugger': ['public/js/main.js:20'],
  'no-only': ['test/focus.js:4', 'test/focus.js:5'],
  'no-secret': ['src/keys.js:1', 'src/keys.js:2', 'src/keys.js:3'],
  'no-random': ['public/js/pattern-core.js:3', 'public/patterns/sparkle.js:3', 'render-box/render.mjs:5'],
  'import-resolve': ['public/index.html:10', 'public/js/main.js:3', 'public/js/main.js:5', 'render-box/render.mjs:4',
    'src/server.js:4'],
  'import-boundary': ['public/js/main.js:4', 'src/server.js:8'],
  'no-deps': ['package.json:4'],
  'lint-allow': ['public/js/main.js:15', 'public/js/main.js:25', 'public/js/main.js:27', 'public/js/main.js:28',
    'tools/ok.py:1'],
};

let root, full, tight;
const at = (result, rule) => result.errors.filter((e) => e.rule === rule).map((e) => `${e.file}:${e.line}`);
const cli = (dir) => new Promise((done) => {
  execFile(process.execPath, [LINT, dir], (error, stdout) => done({ code: error ? error.code : 0, stdout }));
});

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-lint-'));
  fs.cpSync(path.join(FIXTURES, 'tree'), root, { recursive: true });
  for (const [rel, body] of Object.entries(GENERATED)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  [full, tight] = await Promise.all([lint({ root }), lint({ root, limits: { bundle: 600, login: 300 } })]);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('every rule has a fixture', () => {
  assert.deepEqual(Object.keys(EXPECT).sort(), Object.keys(RULES).sort());
  for (const [rule, want] of Object.entries(EXPECT)) assert.ok(want.length, rule);
});

for (const [rule, want] of Object.entries(EXPECT)) {
  test(rule, () => assert.deepEqual(at(rule === 'bundle-size' ? tight : full, rule), want));
}

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

test('valid silences are counted', () => assert.equal(full.silenced, 2));

test('the login path is the page, its eager imports and the sign-in view', () => {
  assert.deepEqual(full.bundle.loginFiles, ['public/app.css', 'public/index.html', 'public/js/main.js',
    'public/js/ui/auth.js', 'public/js/ui/view.js']);
});

test('the command line prints path:line rule message and exits 1 on errors', async () => {
  const { code, stdout } = await cli(root);
  assert.equal(code, 1);
  const lines = stdout.trim().split('\n');
  const errors = lines.filter((l) => !/^(?:lint|bundle): /.test(l));
  assert.equal(errors.length, full.errors.length);
  for (const l of errors) assert.match(l, /^\S+:\d+ [a-z-]+ \S/);
  assert.match(lines.at(-1), /^lint: \d+ errors in \d+ files, \d+ files checked, 2 silenced, [\d.]+ s$/);
});

test('a clean tree passes', async () => {
  const { code, stdout } = await cli(path.join(FIXTURES, 'clean'));
  assert.equal(code, 0, stdout);
  assert.match(stdout, /^lint: 0 errors/m);
});
