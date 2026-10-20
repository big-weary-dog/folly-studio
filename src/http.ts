// The API's HTTP plumbing on Fastify (SPEC "HTTP API"): errors as { error }, the CSRF check on every mutation, JSON
// revalidated by ETag and sent br or gzip when that is worth it, 405 for a known path's other methods, the logger.
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

import { negotiate } from '@fastify/accept-negotiator';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import type { z } from 'zod';

import { problem } from '../shared/schemas/look.ts';
import { scrubText } from '../public/js/scrub.ts';

type Say = (...a: unknown[]) => void;
export type Log = Say & { info: Say, debug: Say, warn: Say, error: Say };
/** What the queues and caches log through: any of Log's levels (console will do). */
export type Logger = Partial<Record<'info' | 'warn' | 'error', Say>>;

/** A logger usable both as log(...) and log.info/warn/error(...). */
export function createLog(prefix = '[studio]'): Log {
  // oxlint-disable-next-line no-console -- the logger: the one place server output is written
  const log = (...a: unknown[]) => console.info(prefix, ...a);
  return Object.assign(log, { info: log, debug: () => {}, warn: (...a: unknown[]) => console.warn(prefix, ...a),
    error: (...a: unknown[]) => console.error(prefix, ...a) });
}

/** An error that becomes an HTTP response `{ error: message }`. */
export class HttpError extends Error {
  status: number; headers: Record<string, string> | undefined;
  constructor(status: number, message: string, headers?: Record<string, string>) {
    super(message);
    [this.status, this.headers] = [status, headers];
  }
}

/** `value` by `schema`, or a 400 naming its first problem. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, problem(r.error));
  return r.data;
}

/** The best encoding a request accepts of `offered` (br before gzip), or null. */
export const pickEncoding = (header: string | undefined, offered = ['br', 'gzip']) =>
  negotiate((header ?? '').toLowerCase(), offered) as 'br' | 'gzip' | null;
/** A weak ETag for a body, and whether an If-None-Match header names it (weak comparison, lists and `*`). */
export const etagOf = (body: string | Buffer) =>
  `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`;
export function etagMatches(header: string | undefined, etag: string): boolean {
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  return !!header && (header.trim() === '*' || header.split(',').some((t) => bare(t) === bare(etag)));
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const bareHost = (host: string) => host.toLowerCase().replace(/:(80|443)$/, '');

/** CSRF (an onRequest hook): a mutation is JSON, and same-origin when it sends an Origin. */
export async function checkMutation(req: FastifyRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let from = '';
    try { from = new URL(origin).host; } catch { /* "null" or garbage */ }
    if (!from || !req.host || bareHost(from) !== bareHost(req.host)) {
      throw new HttpError(403, 'Cross-origin request refused.');
    }
  }
  const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.');
}

// Quality 5 is a millisecond for a large look and within 10 % of the best; JSON is made per request.
const Z = zlib.constants;
const ENCODE = {
  br: (b: Buffer) => zlib.brotliCompressSync(b, { params: { [Z.BROTLI_PARAM_QUALITY]: 5,
    [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_TEXT, [Z.BROTLI_PARAM_SIZE_HINT]: b.length } }),
  gzip: (b: Buffer) => zlib.gzipSync(b, { level: 6 }),
};

/**
 * JSON out (an onSend hook): a GET's 200 is revalidated each time (ETag, 304), so a reload or a poll moves no body
 * when nothing changed; anything else is no-store. 1 KB or more goes br or gzip; the ETag is the plain body's.
 */
export async function sendJson(req: FastifyRequest, reply: FastifyReply, payload: unknown) {
  if (typeof payload !== 'string' || !String(reply.getHeader('content-type')).startsWith('application/json')) {
    return payload;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && reply.statusCode === 200) {
    const etag = etagOf(payload);
    reply.header('cache-control', 'private, no-cache').header('etag', etag);
    if (etagMatches(req.headers['if-none-match'], etag)) {
      reply.code(304);
      return null;
    }
  } else if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  if (payload.length < 1024) return payload;
  reply.header('vary', 'Accept-Encoding');
  const enc = pickEncoding(req.headers['accept-encoding']);
  if (!enc) return payload;
  reply.header('content-encoding', enc);
  return ENCODE[enc](Buffer.from(payload));
}

/** Errors as `{ error }`: an HttpError's or a 4xx's own message; anything else is logged and a 500. */
export function errorHandler(log: Log) {
  return (err: FastifyError | HttpError, req: FastifyRequest, reply: FastifyReply) => {
    const ours = err instanceof HttpError;
    const status = ours ? err.status : err.statusCode ?? 500;
    if (ours && err.headers) reply.headers(err.headers);
    if (ours || status < 500) return reply.code(status).send({ error: err.message });
    log.error?.(`${req.method} ${req.url}:`, err);
    return reply.code(500).send({ error: 'Internal server error.' });
  };
}

type Handler = (req: any, reply: FastifyReply) => unknown;  // each route types its own params
/**
 * Routes from a table ({ 'POST /looks/:id/bake': handler }, or [handler, { public: true }] for one that needs no
 * session), each path's other methods answered 405 with Allow.
 */
export function routes(app: FastifyInstance, table: Record<string, Handler | [Handler, { public?: boolean }]>) {
  const allowed = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(table)) {
    const [method, url] = key.split(' ') as [string, string];
    const [handler, config = {}] = Array.isArray(entry) ? entry : [entry];
    app.route({ method, url, handler: handler as RouteHandlerMethod, config });
    allowed.set(url, [...allowed.get(url) ?? [], method]);
  }
  for (const [url, methods] of allowed) {
    const other = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].filter((m) => !methods.includes(m));
    app.route({ method: other, url, config: { public: true }, handler: async () => {
      throw new HttpError(405, 'Method not allowed.', { Allow: methods.join(', ') });
    } });
  }
}

export type LogLine = { at: string, level: 'warn' | 'error', text: string };
const lineOf = (a: unknown) => {
  if (a instanceof Error) return a.stack ?? a.message;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
};
/** `log`, keeping its last `size` warn and error lines (scrubbed) for bug reports (SPEC "Bug reports"). */
export function keepTail(log: Log, size = 100): Log & { tail(): LogLine[] } {
  const lines: LogLine[] = [];
  const keep = (level: LogLine['level'], say: Say) => (...a: unknown[]) => {
    lines.push({ at: new Date().toISOString(), level, text: scrubText(a.map(lineOf).join(' ')) });
    if (lines.length > size) lines.shift();
    say?.(...a);
  };
  return Object.assign((...a: unknown[]) => log(...a), log, { warn: keep('warn', log.warn),
    error: keep('error', log.error), tail: () => [...lines] });
}
