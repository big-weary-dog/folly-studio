// The library docs (SPEC-generators "Library docs"): the prose against the library, the tree built from both, and
// read_doc for both models: paths held inside the tree (symlinks too), the read cap, claude's tool turns and codex's
// MCP server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { describe, test } from 'vitest';

import { HELP_MAX, normalizeParams } from '../public/js/core/compile.ts';
import { normaliseParam } from '../public/js/ui/bindings.ts';
import { buildCatalog, readParams } from '../src/generate/catalog.ts';
import { createClaudeAdapter } from '../src/generate/claude.ts';
import { docCandidates, READ_CAP, readInside } from '../src/generate/doc-path.ts';
import { buildDocs, lintDocs, loadProse, looksOf, parseProse } from '../src/generate/library-docs.ts';
import { buildPrompt } from '../src/generate/prompt.ts';
import { GROUPS, lookJson, quiet, sse, STUDIO, streamOf, tmp } from './fixtures/generate/shared.js';

// Off until the library's renames (studio-lib) are in the base: the prose is written for the library as it will be,
// so until then a gap either way is a warning. On, it is a failure.
const DOCS_STRICT = false;

const DIR = path.join(STUDIO, 'public/patterns');
const REAL = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).map((p) => ({ ...p,
  code: p.kind === 'preset' ? '' : fs.readFileSync(path.join(DIR, `${p.name}.js`), 'utf8') }));
const PROSE = loadProse(), CATALOG = buildCatalog(REAL, looksOf(PROSE)), DOCS = buildDocs(CATALOG, PROSE);
const INTROS = ['README', 'sources', 'warps', 'filters', 'presets'];

describe('the prose', () => {
  test('every library entry has prose, and the prose names only what the library has', () => {
    const { missing, errors } = lintDocs(CATALOG, PROSE);
    const gaps = [...missing.map((n) => `${n}: no library-docs/${n}.md`), ...errors];
    assert.deepEqual(errors.filter((e) => /no (looks: line|paragraph)$/.test(e)), [], 'prose is whole either way');
    if (DOCS_STRICT) assert.deepEqual(gaps, []);
    else if (gaps.length) console.warn(`library docs (warnings until studio-lib lands):\n  ${gaps.join('\n  ')}`);
  });

  test('each module\'s prose has its line for the prompt, a paragraph and its sections', () => {
    for (const [name, text] of PROSE) {
      if (INTROS.includes(name)) continue;
      const p = parseProse(text);
      assert.ok(p.looks && p.looks.length <= 100, `${name}: looks: line`);
      assert.ok(p.about.length > 80, `${name}: a paragraph`);
      const titles = p.sections.map((s) => s.title);
      assert.ok(titles.includes('Params') || titles.includes('Overrides'), `${name}: Params or Overrides`);
      assert.ok(titles.includes('Pitfalls'), `${name}: Pitfalls`);
    }
  });
});

describe('param help', () => {
  test('every library param has help', () => {
    const { unhelped } = lintDocs(CATALOG, PROSE);
    if (DOCS_STRICT) assert.deepEqual(unhelped, []);
    else if (unhelped.length) console.warn(`params without help (warnings until studio-lib lands): ${unhelped.length}`);
    assert.ok(Array.isArray(unhelped));
  });

  test('the core, the catalogue, the Studio and the docs keep it', () => {
    const help = 'How fast the bars move. Low drifts; high races.';
    const code = `const params = {\n  speed: { value: 0.4, min: -2, max: 2, label: 'Speed (bars a second)', help: '${help}' },
  bars: { value: 4, min: 1, max: 16 },\n};\nfunction pixel() { return [0, 0, 0]; }`;
    assert.equal(normalizeParams({ speed: { value: 1, help: `  ${help}  ` } }).speed.help, help);
    assert.equal(normalizeParams({ speed: { value: 1, help: 'x'.repeat(999) } }).speed.help.length, HELP_MAX);
    assert.equal(normalizeParams({ speed: { value: 1, help: ' ' } }).speed.help, undefined);
    assert.equal(normaliseParam('speed', normalizeParams({ speed: { value: 1, help } }).speed).help, help);
    assert.equal(readParams(code).speed.help, help);
    const catalog = buildCatalog([{ name: 'bars', kind: 'source', title: 'Bars', code }]);
    assert.deepEqual(lintDocs(catalog, new Map()).unhelped, ['bars.bars']);
    const doc = buildDocs(catalog, new Map([['bars', '---\nlooks: bands\n---\nBands.\n## Params\n- speed: Also.\n']]))
      .get('library/sources/bars.md');
    assert.ok(doc.includes(`; bars a second): ${help} Also.\n`), 'help, then what the prose adds');
  });
});

describe('the tree', () => {
  test('a README, a README per kind, and a doc per module and preset, with the catalogue\'s facts', () => {
    assert.ok(DOCS.has('library/README.md'));
    for (const k of ['sources', 'warps', 'filters', 'presets']) assert.ok(DOCS.has(`library/${k}/README.md`), k);
    for (const m of CATALOG.modules.values()) {
      const doc = DOCS.get(`library/${m.kind}s/${m.name}.md`);
      assert.ok(doc, m.name);
      for (const name of Object.keys(m.params)) assert.ok(doc.includes(`- **${name}** (`), `${m.name}.${name}`);
      assert.ok(DOCS.get(`library/${m.kind}s/README.md`).includes(`\n## ${m.name}`), `${m.name} in its README`);
    }
    for (const p of CATALOG.presets.keys()) assert.match(DOCS.get(`library/presets/${p}.md`), /## Recipe\n/, p);
    const bars = DOCS.get('library/sources/bars.md');
    assert.match(bars, /- \*\*speed\*\* \(number -?\d+(\.\d+)?\.\.\d+(\.\d+)?, default [\d.]+(; [^)]+)?\): /);
    assert.deepEqual(buildDocs(buildCatalog([...REAL].reverse(), looksOf(PROSE)), PROSE), DOCS, 'the same bytes');
  });

  test('the prompt summarises the library and says how to read the docs; without prose, no docs', () => {
    const { system, docs } = buildPrompt({ library: REAL, groups: GROUPS, prose: PROSE });
    assert.equal(docs.size, DOCS.size);
    assert.ok(system.includes('read_doc') && system.includes('library/<kind>/<name>.md'));
    const none = buildPrompt({ library: REAL, groups: GROUPS, prose: new Map() });
    assert.equal(none.docs.size, 0);
    assert.ok(!none.system.includes('read_doc'));
  });
});

describe('read_doc', () => {
  test('a path means a file in the tree, leniently, and never one outside it', () => {
    assert.equal(docCandidates('library/sources/bars.md')[0], 'library/sources/bars.md');
    assert.ok(docCandidates('bars').includes('library/sources/bars.md'));
    assert.ok(docCandidates('sources/').includes('library/sources/README.md'));
    assert.ok(docCandidates('library').includes('library/README.md'));
    for (const bad of ['../secret.md', 'library/../../etc/passwd', '/etc/passwd', 'library/./x.md', '~/x', 7, null,
      'library/sources/ba rs.md', 'x'.repeat(300)]) {
      assert.deepEqual(docCandidates(bad), [], String(bad));
    }
  });

  test('on disk, a symlink out of the tree is refused', () => {
    const dir = fs.realpathSync(tmp('docs')), outside = path.join(path.dirname(dir), 'secret.md');
    fs.mkdirSync(path.join(dir, 'library', 'sources'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'library', 'README.md'), 'hello');
    fs.writeFileSync(outside, 'secret');
    fs.symlinkSync(outside, path.join(dir, 'library', 'sources', 'evil.md'));
    fs.symlinkSync(path.dirname(dir), path.join(dir, 'library', 'up'));
    assert.deepEqual(readInside(dir, 'library/README.md'), { rel: 'library/README.md', text: 'hello' });
    assert.equal(readInside(dir, 'library/sources/evil.md'), null);
    assert.equal(readInside(dir, `library/up/${path.basename(outside, '.md')}`), null);
  });

  test('codex\'s MCP server: one tool, the tree only, at most the cap, each read noted', async () => {
    const dir = fs.realpathSync(tmp('mcp')), reads = path.join(dir, 'reads.txt'), tree = path.join(dir, 'tree');
    for (const [rel, text] of DOCS) {
      fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
      fs.writeFileSync(path.join(tree, rel), text);
    }
    const child = spawn(process.execPath, [path.join(STUDIO, 'src/generate/docs-mcp.ts'), tree, reads, '2'],
      { stdio: ['pipe', 'pipe', 'inherit'] });
    const answers = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    let id = 0;
    const rpc = async (method, params) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })}\n`);
      return JSON.parse((await answers.next()).value);
    };
    try {
      assert.equal((await rpc('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name, 'folly-docs');
      child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
      assert.deepEqual((await rpc('tools/list')).result.tools.map((t) => t.name), ['read_doc']);
      const read = async (p) => (await rpc('tools/call', { name: 'read_doc', arguments: { path: p } })).result;
      assert.equal((await read('library/README.md')).content[0].text, DOCS.get('library/README.md'));
      assert.equal((await read('../reads.txt')).isError, true);
      assert.equal((await read('sources/bars')).isError, false);
      assert.match((await read('library/README.md')).content[0].text, /limit of 2 reads/);
      assert.equal(fs.readFileSync(reads, 'utf8'), 'library/README.md\nlibrary/sources/bars.md\n');
    } finally {
      child.kill();
    }
  });

  test('claude: a tool turn is answered from the tree, thinking kept, reads noted and capped', async () => {
    const calls = [], asks = Array.from({ length: READ_CAP + 1 }, (_, i) => i ? 'library/README.md' : 'bars');
    const toolTurn = [
      { type: 'message_start', message: { model: 'm', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'which docs' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
      { type: 'content_block_stop', index: 0 },
      ...asks.flatMap((p, i) => [
        { type: 'content_block_start', index: i + 1, content_block: { type: 'tool_use', id: `t${i}`, name: 'read_doc',
          input: {} } },
        { type: 'content_block_delta', index: i + 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
        { type: 'content_block_delta', index: i + 1, delta: { type: 'input_json_delta',
          partial_json: `${JSON.stringify(p)}}` } },
        { type: 'content_block_stop', index: i + 1 }]),
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      { type: 'message_stop' },
    ];
    const adapter = createClaudeAdapter({ env: {}, apiKey: 'sk-test', log: quiet, fetch: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return sse(calls.length === 1 ? toolTurn : streamOf(lookJson()));
    } });
    const docsRead = [], prompt = buildPrompt({ library: REAL, groups: GROUPS, prose: PROSE });
    const out = await adapter.generate({ text: 'bands', library: REAL, groups: GROUPS, prompt: () => prompt,
      docsRead });
    assert.equal(out.title, 'Reef');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].tools.map((t) => t.name), ['read_doc']);
    const [, assistant, results] = calls[1].messages;
    assert.deepEqual(assistant.content[0], { type: 'thinking', thinking: 'which docs', signature: 'sig' });
    assert.deepEqual(assistant.content[1].input, { path: 'bars' });
    assert.equal(results.content[0].tool_use_id, 't0');
    assert.equal(results.content[0].content, DOCS.get('library/sources/bars.md'));
    assert.equal(results.content.at(-1).is_error, true, 'past the cap');
    assert.equal(docsRead.length, READ_CAP);
    assert.equal(docsRead[0], 'library/sources/bars.md');
  });
});
