// src/generate/claude.js against a mocked fetch: the request, streaming, retries and failures.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createClaudeAdapter, DEFAULT_MODEL } from '../src/generate/claude.js';
import { createQueue } from '../src/generate/index.js';
import { GenerateError } from '../src/generate/validate.js';
import { GROUPS, jsonRes, LIBRARY, lookJson, queueSetup, quiet, sse, streamOf } from './fixtures/generate/shared.js';

describe('claude', () => {
  test('one streamed Messages API call with structured output, caching and the idea only in the user turn',
    async () => {
    const calls = [];
    const adapter = createClaudeAdapter({
      env: {},
      apiKey: 'sk-test',
      log: quiet,
      fetch: async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return sse(streamOf(lookJson()));
      },
    });
    const idea = 'a coral reef breathing in slow blues';
    const out = await adapter.generate({ text: idea, library: LIBRARY, groups: GROUPS });
    assert.equal(out.title, 'Reef');
    assert.equal(out.layers.length, 1);
    assert.equal(calls.length, 1);
    const { url, init, body } = calls[0];
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-api-key'], 'sk-test');
    assert.equal(init.headers['anthropic-version'], '2023-06-01');
    assert.equal(init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(body.model, 'claude-opus-5-5');
    assert.equal(body.stream, true);
    assert.equal(body.fallbacks, 'default');
    assert.deepEqual(body.thinking, { type: 'adaptive' });
    assert.equal(body.output_config.effort, 'medium');
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.equal(body.output_config.format.schema.additionalProperties, false);
    assert.equal(body.max_tokens, 32000);
    assert.equal(body.system.length, 1);
    assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
    assert.ok(!body.system[0].text.includes(idea));
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, 'user');
    assert.ok(body.messages[0].content.includes(`<idea>\n${idea}\n</idea>`));
  });

  test('model and effort come from the environment; fallbacks only where supported', () => {
    const a = createClaudeAdapter({ env: { ANTHROPIC_API_KEY: 'k', STUDIO_CLAUDE_MODEL: 'claude-haiku-5-5',
      STUDIO_CLAUDE_EFFORT: 'low' } });
    const { body, headers } = a.buildRequest({ text: 'x', library: [], groups: [] });
    assert.equal(body.model, 'claude-haiku-5-5');
    assert.equal(body.output_config.effort, 'low');
    assert.equal(body.fallbacks, undefined);
    assert.equal(headers['anthropic-beta'], undefined);
    const b = createClaudeAdapter({ env: { ANTHROPIC_API_KEY: 'k', STUDIO_CLAUDE_FALLBACKS: '0' } });
    assert.equal(b.buildRequest({ text: 'x' }).body.fallbacks, undefined);
  });

  test('retries once on overload, then gives up with a user-safe message', async () => {
    let n = 0;
    const ok = createClaudeAdapter({
      env: {}, apiKey: 'k', log: quiet, retryDelayMs: 1,
      fetch: async () => (++n === 1 ? jsonRes(529, { type: 'error', error: { type: 'overloaded_error',
        message: 'Overloaded' } }) : jsonRes(200, { stop_reason: 'end_turn', content: [{ type: 'text',
          text: lookJson() }] })),
    });
    assert.equal((await ok.generate({ text: 'x' })).title, 'Reef');
    assert.equal(n, 2);

    let m = 0;
    const busy = createClaudeAdapter({ env: {}, apiKey: 'k', log: quiet, retryDelayMs: 1, fetch: async () => (m++,
      jsonRes(429, { error: { type: 'rate_limit_error' } }, { 'retry-after': '0' })) });
    await assert.rejects(busy.generate({ text: 'x' }), (e) => e instanceof GenerateError && /busy/.test(e.userMessage));
    assert.equal(m, 2);

    let k = 0;
    const bad = createClaudeAdapter({ env: {}, apiKey: 'k', log: quiet, fetch: async () => (k++, jsonRes(400,
      { error: { type: 'invalid_request_error', message: 'nope' } })) });
    await assert.rejects(bad.generate({ text: 'x' }),
      (e) => e instanceof GenerateError && !/sk-|nope/.test(e.userMessage));
    assert.equal(k, 1, 'no retry on 400');

    let s = 0;
    const midStream = createClaudeAdapter({
      env: {}, apiKey: 'k', log: quiet, retryDelayMs: 1,
      fetch: async () => (++s === 1 ? sse([{ type: 'message_start', message: {} }, { type: 'error',
        error: { type: 'overloaded_error', message: 'Overloaded' } }]) : sse(streamOf(lookJson()))),
    });
    assert.equal((await midStream.generate({ text: 'x' })).title, 'Reef');
    assert.equal(s, 2);
  });

  test('no key, refusal, truncation, junk and timeouts fail cleanly', async () => {
    let called = false;
    const nokey = createClaudeAdapter({ env: {}, fetch: async () => (called = true) });
    await assert.rejects(nokey.generate({ text: 'x' }),
      (e) => e instanceof GenerateError && /not configured/.test(e.userMessage));
    assert.equal(called, false);

    const make = (events) => createClaudeAdapter({ env: {}, apiKey: 'k', log: quiet, fetch: async () => sse(events) });
    await assert.rejects(make(streamOf('{"title":', 'refusal')).generate({ text: 'x' }),
      (e) => /declined/.test(e.userMessage));
    await assert.rejects(make(streamOf('{"title": "Re', 'max_tokens')).generate({ text: 'x' }),
      (e) => /ran out of room/.test(e.userMessage));
    await assert.rejects(make(streamOf('not json at all')).generate({ text: 'x' }),
      (e) => /could not read/.test(e.userMessage));

    const slow = createClaudeAdapter({
      env: {}, apiKey: 'k', log: quiet, timeoutMs: 30,
      fetch: (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort',
        () => reject(new DOMException('aborted', 'AbortError')))),
    });
    await assert.rejects(slow.generate({ text: 'x' }), (e) => /took too long/.test(e.userMessage));
  });

  test('reads the fallback model’s answer after a refusal boundary', async () => {
    const events = [
      { type: 'message_start', message: { model: 'claude-opus-5' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"tit' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'fallback', from: { model: 'claude-opus-5-5' },
        to: { model: 'claude-opus-5' } } },
      { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: lookJson() } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ];
    const a = createClaudeAdapter({ env: {}, apiKey: 'k', log: quiet, fetch: async () => sse(events) });
    assert.equal((await a.generate({ text: 'x' })).title, 'Reef');
  });

  test('claude through the queue with a mocked fetch', async () => {
    const realFetch = globalThis.fetch;
    const key = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    globalThis.fetch = async () => sse(streamOf(lookJson()));
    try {
      const { store, idea, queue } = queueSetup(createQueue, { adapterName: 'claude' });
      const i = idea('a reef');
      queue.enqueue(i);
      await queue.idle();
      const done = store.ideas.get(i.id);
      assert.equal(done.status, 'ready', done.error);
      assert.equal(store.looks.get(done.lookId).title, 'Reef');
    } finally {
      globalThis.fetch = realFetch;
      if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = key;
    }
  });
});
