// claude: one Messages API call turns an idea into a look. Plain fetch, streamed so a long answer never
// sits on an idle connection, with structured output so the reply is the look's JSON. The big static
// system prompt is cached; the idea goes only in the user turn.

import { buildSystemPrompt, buildUserMessage, lookSchema } from './prompt.js';
import { GenerateError } from './validate.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const API_VERSION = '2023-06-01';
// Server-side refusal fallback ("default" routes by refusal category). Only these models take it.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

class ApiError extends Error {
  constructor(message, { status = 0, type = '', retryable = false, retryAfterMs = 0 } = {}) {
    super(message);
    Object.assign(this, { status, type, retryable, retryAfterMs });
  }
}

const num = (v, d) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

// Options (environment): fetch, apiKey (ANTHROPIC_API_KEY), model (STUDIO_CLAUDE_MODEL), effort
// (STUDIO_CLAUDE_EFFORT, medium), maxTokens (STUDIO_CLAUDE_MAX_TOKENS, 32000, thinking included), timeoutMs
// (STUDIO_CLAUDE_TIMEOUT_MS, 300000 per attempt).
export function createClaudeAdapter(o = {}) {
  const env = o.env || process.env;
  const cfg = {
    fetch: o.fetch || ((...a) => globalThis.fetch(...a)),
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

  async function generate({ text, library = [], groups = [] }) {
    if (!cfg.apiKey) {
      throw new GenerateError('The AI generator is not configured on this server.', 'no ANTHROPIC_API_KEY');
    }
    const { body, headers } = buildRequest({ text, library, groups });
    let message;
    for (let attempt = 1; ; attempt++) {
      try {
        message = await callOnce(body, headers);
        break;
      } catch (err) {
        if (err instanceof ApiError && err.retryable && attempt < 2) {
          cfg.log.warn?.(`[generate/claude] ${err.message}; retrying once`);
          await new Promise((r) => setTimeout(r, Math.min(err.retryAfterMs || cfg.retryDelayMs, 30_000)));
          continue;
        }
        throw toUserError(err);
      }
    }
    return readLook(message);
  }

  function buildRequest({ text, library, groups }) {
    const body = {
      model: cfg.model, max_tokens: cfg.maxTokens, stream: true, thinking: { type: 'adaptive' },
      output_config: { effort: cfg.effort, format: { type: 'json_schema', schema: lookSchema(groups) } },
      system: [{ type: 'text', text: buildSystemPrompt({ library, groups }), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserMessage(text) }],
    };
    const headers = { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': API_VERSION };
    if (cfg.fallbacks && FALLBACK_MODELS.has(cfg.model)) {
      body.fallbacks = 'default';
      headers['anthropic-beta'] = FALLBACK_BETA;
    }
    return { body, headers };
  }

  async function callOnce(body, headers) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    try {
      const init = { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal };
      const res = await cfg.fetch(`${cfg.baseUrl}/v1/messages`, init).catch((err) => {
        if (ac.signal.aborted) throw new ApiError('timed out', { type: 'timeout' });
        throw new ApiError(`network error: ${err.message}`, { type: 'network', retryable: true });
      });
      if (!res.ok) throw await httpError(res);
      const type = res.headers.get('content-type') || '';
      try {
        if (type.includes('text/event-stream')) return await readStream(res.body);
        return await res.json();
      } catch (err) {
        if (ac.signal.aborted) throw new ApiError('timed out', { type: 'timeout' });
        if (err instanceof ApiError) throw err;
        throw new ApiError(`reading the response failed: ${err.message}`, { type: 'network', retryable: true });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return { name: 'claude', generate, buildRequest, config: cfg };
}

async function httpError(res) {
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
async function readStream(body) {
  const msg = { model: '', stop_reason: null, content: [] };
  const reader = body.getReader(), dec = new TextDecoder();
  let done = false, buf = '';
  const handle = (raw) => {
    let data = '';
    for (const line of raw.split('\n')) if (line.startsWith('data:')) data += line.slice(5).trimStart();
    if (!data) return;
    let ev;
    try { ev = JSON.parse(data); } catch { return; }
    switch (ev.type) {
      case 'message_start':
        msg.model = ev.message?.model || '';
        break;
      case 'content_block_start':
        msg.content[ev.index] = { ...ev.content_block };
        if (msg.content[ev.index].type === 'text') msg.content[ev.index].text ??= '';
        break;
      case 'content_block_delta': {
        const b = msg.content[ev.index];
        if (b && ev.delta?.type === 'text_delta') b.text = (b.text || '') + ev.delta.text;
        break;
      }
      case 'message_delta':
        if (ev.delta?.stop_reason) msg.stop_reason = ev.delta.stop_reason;
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
    while ((i = buf.indexOf('\n\n')) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) handle(buf);
  if (!done) throw new ApiError('stream ended early', { type: 'network', retryable: true });
  msg.content = msg.content.filter(Boolean);
  return msg;
}

function toUserError(err) {
  if (err instanceof GenerateError) return err;
  const why = !(err instanceof ApiError) ? 'failed.'
    : err.type === 'timeout' ? 'took too long; please try again.'
    : err.status === 401 || err.status === 403 ? 'is misconfigured on this server.'
    : err.retryable ? 'is busy right now; please try again in a few minutes.'
    : 'could not handle this idea.';
  return new GenerateError(`The AI generator ${why}`, err?.message);
}

/** Pull the look JSON out of a final message. */
function readLook(message) {
  const stop = message?.stop_reason;
  if (stop === 'refusal') throw new GenerateError('The AI declined this idea. Try describing it differently.', stop);
  if (stop === 'max_tokens') {
    throw new GenerateError('The AI ran out of room before finishing this look; try a simpler idea.', stop);
  }
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const texts = (from) => blocks.slice(from).filter((b) => b?.type === 'text').map((b) => b.text || '').join('');
  // After a mid-stream refusal fallback, the text continues across the boundary; if that does
  // not parse, the text after the last fallback block is the fallback model's whole answer.
  const lastFallback = blocks.map((b) => b?.type).lastIndexOf('fallback');
  const candidates = [texts(0)];
  if (lastFallback >= 0) candidates.push(texts(lastFallback + 1));
  for (const t of candidates) {
    const look = parseJson(t);
    if (look && typeof look === 'object' && !Array.isArray(look)) {
      return { title: look.title, summary: look.summary, duration: look.duration, layers: look.layers };
    }
  }
  const detail = `unparseable output, stop_reason ${stop}`;
  throw new GenerateError('The AI returned a look the studio could not read.', detail);
}

/** JSON from text, or from its outermost {…} when something surrounds it; null when neither parses. */
function parseJson(text) {
  const t = String(text || '').trim();
  for (const candidate of [t, t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)]) {
    try {
      if (candidate) return JSON.parse(candidate);
    } catch { /* the next candidate */ }
  }
  return null;
}
