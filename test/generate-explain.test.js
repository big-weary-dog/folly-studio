// What a round says of itself (src/generate/explain.ts, SPEC-generators "The idea log"): the thinking summary from
// Claude's blocks and Codex's items, the answer's critique, plan and whys on what changed, the check's numbers, and
// the summary kept on the idea within its size.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { expand } from '../src/generate/expand.ts';
import { changesOf, checksOf, explainOf, HOW_BYTES, howOf, thinkingOf } from '../src/generate/explain.ts';
import { CATALOG } from './fixtures/generate/box.js';

const SOURCE = [...CATALOG.modules].find(([, m]) => m.kind === 'source')[0];
const swell = (level, why) => ({ title: 'Swell', groups: ['cathedral'], blend: 'add', level,
  modules: [{ use: SOURCE, params: [] }], ...(why ? { why } : {}) });
const lookOf = (raw) => expand(raw, CATALOG).look;

describe('what a round says of itself', () => {
  test('the thinking summary: Claude\'s thinking blocks, Codex\'s reasoning items; none when there is none', () => {
    assert.equal(thinkingOf({ reply: [{ type: 'thinking', thinking: 'Warm first.' }, { type: 'text', text: '{}' },
      { type: 'thinking', thinking: 'Then slow.' }] }), 'Warm first.\n\nThen slow.');
    assert.equal(thinkingOf({ tools: [{ type: 'reasoning', text: 'A tide.' }, { type: 'agent_message', text: 'x' }] }),
      'A tide.');
    assert.equal(thinkingOf({ reply: [{ type: 'thinking', thinking: '' }], tools: [] }), '');
    assert.equal(thinkingOf({ reply: 'not blocks' }), '');
  });

  test('its critique and plan, bounded; anything else is not its to say', () => {
    assert.deepEqual(explainOf({ critique: ' Too dark. ', plan: 'x'.repeat(900), title: 'T' }),
      { critique: 'Too dark.', plan: 'x'.repeat(600) });
    assert.deepEqual(explainOf({ plan: 3 }), {});
    assert.deepEqual(explainOf(null), {});
  });

  test('what changed, each line with the why its layer or edit gave', () => {
    const first = { title: 'Tide', summary: 'S', layers: [swell(0.8, 'a slow swell')] };
    assert.deepEqual(changesOf(null, lookOf(first), first, CATALOG),
      [{ text: `+ layer Swell (${SOURCE})`, why: 'a slow swell' }]);
    const edits = { edits: [{ op: 'set', path: 'layers/Swell/level', value: 0.4, why: 'it drowned the spires' }] };
    const after = { ...first, layers: [swell(0.4)] };
    assert.deepEqual(changesOf(lookOf(first), lookOf(after), edits, CATALOG),
      [{ text: 'Swell: level 0.8 → 0.4', why: 'it drowned the spires' }]);
    assert.deepEqual(changesOf(lookOf(first), lookOf(after), {}, CATALOG), [{ text: 'Swell: level 0.8 → 0.4' }]);
    assert.deepEqual(changesOf(lookOf(first), lookOf(first), first, CATALOG), []);
  });

  test('the render check as numbers', () => {
    assert.equal(checksOf(null), undefined);
    assert.deepEqual(checksOf({ ms: 41.6, errors: [{ path: 'a', message: 'b' }], seconds: 2 }), { ms: 42, errors: 1 });
    const analysis = { meanBrightness: 0.31234, darkFraction: 0.2, flicker: { ok: true, maxHz: 2.5 } };
    assert.deepEqual(checksOf({ ms: 10, errors: [], seconds: 2, analysis }),
      { ms: 10, errors: 0, meanBrightness: 0.312, darkFraction: 0.2, flashHz: 2.5, flashOk: true });
  });

  test('the idea keeps it within its size: the oldest rounds\' thinking goes first', () => {
    const round = (n) => ({ n, kind: 'critique', ms: 9, calls: 1, outcome: 'revised', plan: 'p', critique: 'c',
      thinking: 't'.repeat(5000), changes: Array.from({ length: 30 }, (_, i) => ({ text: `L: speed ${i} → 1` })),
      checks: { ms: 3, errors: 0 }, stills: [{ file: 'a.png' }, { file: 'b.png' }], notes: ['kept out'] });
    const small = howOf([round(1)]);
    assert.deepEqual(Object.keys(small[0]).sort(), ['changes', 'checks', 'critique', 'kind', 'ms', 'n', 'outcome',
      'plan', 'stills', 'thinking']);
    assert.deepEqual([small[0].thinking.length, small[0].changes.length, small[0].stills], [600, 12, 2]);
    const many = howOf(Array.from({ length: 6 }, (_, i) => round(i + 1)));
    assert.ok(JSON.stringify(many).length <= HOW_BYTES, JSON.stringify(many).length);
    assert.equal(many.at(-1).n, 6, 'the latest round stays');
    assert.ok(!many[0].thinking && many.at(-1).thinking, 'the oldest thinking went first');
  });
});
