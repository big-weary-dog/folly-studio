// The docs an idea's turns carry (SPEC-generators "Library docs"): the pages picked, the block each call sends (a cache
// point on claude), and read_doc declining a page the turn already has.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { createClaudeAdapter } from '../src/generate/claude.ts';
import { docsBlock, MAX_GIVEN, pickDocs } from '../src/generate/docs-turn.ts';
import { buildPrompt } from '../src/generate/prompt.ts';
import { REAL } from './fixtures/generate/box.js';
import { GROUPS, lookJson, quiet, sse, streamOf } from './fixtures/generate/shared.js';

const PROMPT = buildPrompt({ library: REAL, groups: GROUPS }), TREE = PROMPT.docs;

describe('picking', () => {
  test('the pages named, leniently, found in the tree, once each, at most MAX_GIVEN; none named, none', () => {
    assert.deepEqual(pickDocs(TREE, ['bars', 'library/sources/bars.md', 'warps', '../x', 'nothing', 7, 'extensions']),
      ['library/sources/bars.md', 'library/warps/README.md', 'library/extensions.md']);
    assert.equal(pickDocs(TREE, [...TREE.keys()]).length, MAX_GIVEN);
    assert.deepEqual(pickDocs(TREE, []), []);
  });

  test('the block: each page whole in a <doc>, none for none or a page the tree lacks', () => {
    const block = docsBlock(TREE, ['library/sources/bars.md', 'library/nope.md']), bars = 'library/sources/bars.md';
    assert.ok(block.includes(`<doc path="${bars}">\n${TREE.get(bars).trim()}\n</doc>`));
    assert.doesNotMatch(block, /nope/);
    assert.equal(docsBlock(TREE, []), '');
  });
});

describe('claude', () => {
  test('every call carries the pages given before its turn; read_doc of one is declined and not counted', async () => {
    const calls = [];
    const ask = [{ type: 'message_start', message: { model: 'm', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't0', name: 'read_doc',
        input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"bars"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' }];
    const adapter = createClaudeAdapter({ env: {}, apiKey: 'sk-test', log: quiet, fetch: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return sse(calls.length === 1 ? ask : streamOf(lookJson()));
    } });
    const docsRead = [], docsGiven = ['library/README.md', 'library/sources/bars.md'];
    const ctx = { text: 'bands', library: REAL, groups: GROUPS, prompt: () => PROMPT, docsRead, docsGiven };
    await adapter.generate(ctx);
    const first = calls[0].messages[0].content, [opening] = first;
    assert.equal(first.length, 1);
    assert.match(opening.text, /^The library docs for this idea/);
    assert.ok(opening.text.includes('<doc path="library/sources/bars.md">'));
    assert.match(opening.text, /<idea>\nbands\n<\/idea>/, 'the turn follows the docs');
    assert.deepEqual(opening.cache_control, { type: 'ephemeral' }, 'the first turn is cached with the system');
    const result = calls[1].messages[2].content[0];
    assert.equal(result.is_error, true);
    assert.match(result.content, /library\/sources\/bars\.md is in the turn already/);
    assert.deepEqual(docsRead, []);
    calls.length = 1;
    await adapter.generate({ ...ctx, repair: { answer: {}, errors: [], message: 'again' } });
    assert.deepEqual(calls[1].messages[0].content, first, 'a later round sends the same pages');
    assert.equal(calls[1].system[0].text, calls[0].system[0].text, 'the cached prefix is the same');
  });
});
