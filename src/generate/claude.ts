// claude: one Messages API call turns an idea into a look. Plain fetch, streamed so a long answer never
// sits on an idle connection, with structured output so the reply is the look's JSON (the schema is the generated
// look's, shared/schemas/generated.ts). The big static system prompt is cached, built once per library and rig (the
// queue's ctx.prompt) and byte for byte the same on every call; the idea goes only in the user turn. The one tool,
// read_doc, answers from the library docs in memory: a tool call is answered and the call made again.

import { GenerateError } from '../../shared/schemas/generated.ts';
import type { Logger } from '../http.ts';
import type { Context } from './index.ts';
import { docCandidates, READ_CAP, READ_DOC_DESCRIPTION } from './doc-path.ts';
import { docsBlock, givenAnswer } from './docs-turn.ts';
import { buildPrompt, buildRepairMessage, buildUserMessage } from './prompt.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const API_VERSION = '2023-06-01';
// Server-side refusal fallback ("default" routes by refusal category). Only these models take it.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const MAX_CALLS = 12; // an answer's calls, tool rounds included
const READ_DOC = { name: 'read_doc', description: READ_DOC_DESCRIPTION, input_schema: { type: 'object',
  properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } };

class ApiError extends Error {
  status = 0; type = ''; retryable = false; retryAfterMs = 0;
  constructor(message: string, failure: Partial<ApiError> = {}) {
    super(message);
    Object.assign(this, failure);
  }
}

const num = (v: unknown, d: number) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

// Options (environment): fetch, apiKey (ANTHROPIC_API_KEY), model (STUDIO_CLAUDE_MODEL), effort
// (STUDIO_CLAUDE_EFFORT, medium), maxTokens (STUDIO_CLAUDE_MAX_TOKENS, 32000, thinking included), timeoutMs
// (STUDIO_CLAUDE_TIMEOUT_MS, 300000 per attempt).
type Options = Partial<{ env: NodeJS.ProcessEnv, fetch: typeof fetch, apiKey: string, model: string, effort: string,
  maxTokens: number, timeoutMs: number, retryDelayMs: number, baseUrl: string, fallbacks: boolean, log: Logger }>;
export function createClaudeAdapter(o: Options = {}) {
  const env = o.env || process.env;
  const cfg = {
    fetch: o.fetch || ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a)),
    apiKey: o.apiKey ?? env.ANTHROPIC_API_KEY,
    model: o.model || env.STUDIO_CLAUDE_MODEL || DEFAULT_MODEL,
    effort: o.effort || env.STUDIO_CLAUDE_EFFORT || 'medium',
    maxTokens: num(o.maxTokens ?? env.STUDIO_CLAUDE_MAX_TOKENS, 32000),
    timeoutMs: num(o.timeoutMs ?? env.STUDIO_CLAUDE_TIMEOUT_MS, 300_000),
    retryDelayMs: num(o.retryDelayMs, 2000),
    baseUrl: (o.baseUrl || env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    fallbacks: o.fallbacks ?? env.STUDIO_CLAUDE_FALLBACKS !== '0',
    log: o.log || console,
  };
  if (!EFFORTS.has(cfg.effort)) cfg.effort = 'medium';

  async function generate(ctx: Context) {
    const { text, library = [], rig, groups = rig?.groups || [], prompt, turn, repair, signal, docsRead = [], schema,
      images, docsGiven = [] } = ctx;
    if (!cfg.apiKey) {
      throw new GenerateError('The AI generator is not configured on this server.', 'no ANTHROPIC_API_KEY');
    }
    const { body, headers, docs } = buildRequest({ text, library, rig, groups, prompt, turn, repair, schema, images,
      docsGiven });
    const messages = body.messages as object[];
    const t0 = Date.now(), usage = { input: 0, cached: 0, output: 0, reasoning: 0 }, from = docsRead.length;
    let reads = 0, reply: Block[] | undefined, failed = '';
    try {
      for (let calls = 1; ; calls++) {
        const message = await callRetrying(body, headers, signal);
        const u = message.usage ?? {}, cached = Number(u.cache_read_input_tokens) || 0;
        usage.input += (Number(u.input_tokens) || 0) + cached + (Number(u.cache_creation_input_tokens) || 0);
        usage.cached += cached;
        usage.output += Number(u.output_tokens) || 0;
        reply = message.content;
        const asks = (message.content ?? []).filter((b) => b.type === 'tool_use');
        if (message.stop_reason !== 'tool_use' || !asks.length) return readLook(message, !!schema);
        if (calls >= MAX_CALLS) throw new GenerateError('The AI generator failed; please try again.', 'too many calls');
        messages.push({ role: 'assistant', content: message.content },
          { role: 'user', content: asks.map((b) => ({ type: 'tool_result', tool_use_id: b.id,
            ...readDoc(docs, (b.input as { path?: unknown } | undefined)?.path, reads++ < READ_CAP, docsRead,
              docsGiven) })) });
      }
    } catch (err) {
      failed = String((err as Error)?.message || err);
      throw err;
    } finally {
      // The transcript for the idea log: every turn as sent (images as a placeholder: the log keeps them as stills).
      const turn = JSON.parse(JSON.stringify(messages, (k, v) => (k === 'source' && v?.type === 'base64'
        ? { type: 'base64', media_type: v.media_type, bytes: Buffer.byteLength(v.data ?? '', 'base64') } : v)));
      ctx.round?.call({ ms: Date.now() - t0, system: (body.system as { text: string }[])[0]!.text, turn, reply,
        usage, docs: docsRead.slice(from), ...(failed ? { error: failed } : {}) });
    }
  }

  async function callRetrying(body: object, headers: Record<string, string>, signal?: AbortSignal):
    Promise<Message> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await callOnce(body, headers, signal);
      } catch (err) {
        if (err instanceof ApiError && err.retryable && attempt < 2) {
          cfg.log.warn?.(`[generate/claude] ${err.message}; retrying once`);
          await new Promise((r) => setTimeout(r, Math.min(err.retryAfterMs || cfg.retryDelayMs, 30_000)));
          continue;
        }
        throw toUserError(err);
      }
    }
  }

  function buildRequest({ text, library, rig, groups, prompt, turn, repair, schema: asked, images: first = [],
    docsGiven = [] }: Pick<Context, 'text' | 'library' | 'rig' | 'groups'> & Partial<Pick<Context, 'prompt' | 'turn'
    | 'repair' | 'schema' | 'images' | 'docsGiven'>>) {
    const built = prompt?.() ?? buildPrompt({ library, rig, groups }), { system } = built;
    const tree = built.docs ?? new Map<string, string>(), given = docsBlock(tree, docsGiven);
    const schema = asked ?? built.schema, docs = asked ? new Map<string, string>() : tree;
    const said = repair?.message ?? buildRepairMessage(repair?.errors ?? []);
    const blocks = (pngs: Uint8Array[]) => pngs.map((png) => ({ type: 'image', source: { type: 'base64',
      media_type: 'image/png', data: Buffer.from(png).toString('base64') } }));
    const withImages = (pngs: Uint8Array[], t: string) => (pngs.length ? [...blocks(pngs), { type: 'text', text: t }]
      : t);
    const turns = repair ? [{ role: 'assistant', content: JSON.stringify(repair.answer) },
      { role: 'user', content: withImages(repair.images ?? [], said) }] : [];
    const body: Record<string, unknown> = {
      model: cfg.model, max_tokens: cfg.maxTokens, stream: true, thinking: { type: 'adaptive' },
      output_config: { effort: cfg.effort, format: { type: 'json_schema', schema } },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: withImages(first, given + (turn ?? buildUserMessage(text))) }, ...turns],
      ...(docs.size ? { tools: [READ_DOC] } : {}),
    };
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': cfg.apiKey!,
      'anthropic-version': API_VERSION };
    if (cfg.fallbacks && FALLBACK_MODELS.has(cfg.model)) {
      body.fallbacks = 'default';
      headers['anthropic-beta'] = FALLBACK_BETA;
    }
    return { body, headers, docs };
  }

  async function callOnce(body: object, headers: Record<string, string>, stop?: AbortSignal) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    const onStop = () => ac.abort();
    stop?.addEventListener('abort', onStop, { once: true });
    try {
      const init = { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal };
      const res = await cfg.fetch(`${cfg.baseUrl}/v1/messages`, init).catch((err) => {
        if (ac.signal.aborted) throw new ApiError('timed out', { type: 'timeout' });
        throw new ApiError(`network error: ${err.message}`, { type: 'network', retryable: true });
      });
      if (!res.ok) throw await httpError(res);
      const type = res.headers.get('content-type') || '';
      try {
        if (type.includes('text/event-stream')) return await readStream(res.body!);
        return await res.json();
      } catch (err) {
        if (ac.signal.aborted) throw new ApiError('timed out', { type: 'timeout' });
        if (err instanceof ApiError) throw err;
        const why = `reading the response failed: ${(err as Error).message}`;
        throw new ApiError(why, { type: 'network', retryable: true });
      }
    } finally {
      clearTimeout(timer);
      stop?.removeEventListener('abort', onStop);
    }
  }

  return { name: 'claude', generate, buildRequest, config: cfg };
}

async function httpError(res: Response) {
  const j = await res.json().catch(() => null);
  const type = j?.error?.type || '';
  const detail = String(j?.error?.message || '').slice(0, 300);
  const s = res.status;
  const ra = Number(res.headers.get('retry-after'));
  const retryable = s === 429 || s >= 500 || type === 'overloaded_error';
  const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0;
  return new ApiError(`HTTP ${s} ${type} ${detail}`.trim(), { status: s, type, retryable, retryAfterMs });
}

/** Read a Messages API SSE stream into a message object ({ model, stop_reason, content }). */
type Block = { type?: string, text?: string, thinking?: string, signature?: string, id?: string, input?: unknown,
  json?: string };
type Message = { model?: string, stop_reason?: string | null, content?: Block[], usage?: Record<string, unknown> };
async function readStream(body: ReadableStream<Uint8Array>) {
  const msg: Required<Message> = { model: '', stop_reason: null, content: [], usage: {} };
  const reader = body.getReader(), dec = new TextDecoder();
  let done = false, buf = '';
  const handle = (raw: string) => {
    let data = '';
    for (const line of raw.split('\n')) if (line.startsWith('data:')) data += line.slice(5).trimStart();
    if (!data) return;
    let ev;
    try { ev = JSON.parse(data); } catch { return; }
    switch (ev.type) {
      case 'message_start':
        msg.model = ev.message?.model || '';
        Object.assign(msg.usage, ev.message?.usage);
        break;
      case 'content_block_start':
        msg.content[ev.index] = { ...ev.content_block };
        if (msg.content[ev.index]!.type === 'text') msg.content[ev.index]!.text ??= '';
        break;
      case 'content_block_delta': { // text, a tool call's input, thinking and its signature: all go back on a tool turn
        const b = msg.content[ev.index], d = ev.delta;
        if (!b) break;
        if (d?.type === 'text_delta') b.text = (b.text || '') + d.text;
        else if (d?.type === 'input_json_delta') b.json = (b.json || '') + d.partial_json;
        else if (d?.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
        else if (d?.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        break;
      }
      case 'content_block_stop': {
        const b = msg.content[ev.index];
        if (b?.json !== undefined) {
          try { b.input = JSON.parse(b.json || '{}'); } catch { b.input = {}; }
          delete b.json;
        }
        break;
      }
      case 'message_delta':
        if (ev.delta?.stop_reason) msg.stop_reason = ev.delta.stop_reason;
        Object.assign(msg.usage, ev.usage); // its output_tokens are the message's, so far
        break;
      case 'message_stop':
        done = true;
        break;
      case 'error': {
        const t = ev.error?.type || 'error';
        const retryable = t === 'overloaded_error' || t === 'api_error' || t === 'rate_limit_error';
        const said = String(ev.error?.message || '').slice(0, 200);
        throw new ApiError(`stream error ${t}: ${said}`, { type: t, retryable });
      }
    }
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    buf = buf.replace(/\r\n?/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  if (buf.trim()) handle(buf);
  if (!done) throw new ApiError('stream ended early', { type: 'network', retryable: true });
  msg.content = msg.content.filter(Boolean);
  return msg;
}

/** A read_doc call's answer from the tree: the doc, or why not (the tree's README names the rest). */
function readDoc(docs: ReadonlyMap<string, string>, raw: unknown, allowed: boolean, read: string[],
  given: readonly string[]) {
  if (!allowed) return { content: `The limit of ${READ_CAP} reads is reached: compose the look now.`, is_error: true };
  const path = docCandidates(raw).find((p) => docs.has(p));
  if (!path) {
    return { content: `No such doc: ${String(raw).slice(0, 80)}: a module's page is library/<kind>/<name>.md.`,
      is_error: true };
  }
  if (given.includes(path)) return { content: givenAnswer(path), is_error: true };
  read.push(path);
  return { content: docs.get(path)! };
}

function toUserError(err: unknown) {
  if (err instanceof GenerateError) return err;
  const why = !(err instanceof ApiError) ? 'failed.'
    : err.type === 'timeout' ? 'took too long; please try again.'
    : err.status === 401 || err.status === 403 ? 'is misconfigured on this server.'
    : err.retryable ? 'is busy right now; please try again in a few minutes.'
    : 'could not handle this idea.';
  return new GenerateError(`The AI generator ${why}`, (err as Error)?.message);
}

/** Pull the look JSON out of a final message (`raw`: the answer to another schema, as it parsed). */
function readLook(message: Message, raw = false) {
  const stop = message?.stop_reason;
  if (stop === 'refusal') throw new GenerateError('The AI declined this idea. Try describing it differently.', stop);
  if (stop === 'max_tokens') {
    throw new GenerateError('The AI ran out of room before finishing this look; try a simpler idea.', stop);
  }
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const texts = (from: number) => blocks.slice(from).filter((b) => b?.type === 'text').map((b) => b.text).join('');
  // After a mid-stream refusal fallback, the text continues across the boundary; if that does
  // not parse, the text after the last fallback block is the fallback model's whole answer.
  const lastFallback = blocks.map((b) => b?.type).lastIndexOf('fallback');
  const candidates = [texts(0)];
  if (lastFallback >= 0) candidates.push(texts(lastFallback + 1));
  for (const t of candidates) {
    const look = raw ? parseJson(t) : pickLook(parseJson(t));
    if (look) return look;
  }
  const detail = `unparseable output, stop_reason ${stop}`;
  throw new GenerateError('The AI returned a look the studio could not read.', detail);
}

/** A look's fields from a parsed answer; null when it is not an object. The codex adapter reads its answer so too. */
export function pickLook(look: unknown) {
  if (!look || typeof look !== 'object' || Array.isArray(look)) return null;
  const { title, summary, duration, bpm, globals, automation, layers, extensions } = look as Record<string, unknown>;
  return { title, summary, duration, bpm, globals, automation, layers, extensions };
}

/** JSON from text, or from its outermost {…} when something surrounds it; null when neither parses. */
export function parseJson(text: string): unknown {
  const t = String(text || '').trim();
  for (const candidate of [t, t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)]) {
    try {
      if (candidate) return JSON.parse(candidate);
    } catch { /* the next candidate */ }
  }
  return null;
}
