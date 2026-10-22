// The request log and the server's stats (SPEC-access "Stats"): a journal line for each request worth reading, and a
// few bounded counters for Admin → Stats. Kept in memory only, so a restart starts them again.
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { isPending } from '../shared/idea-status.ts';
import type { ServerStats, StatsDay } from '../shared/schemas/api.ts';
import { forAdmins, type Log } from './http.ts';
import type { Store } from './store.ts';

const DAYS = 7, SLOW_MS = 1000, SLOWEST = 10, MAX_VISITORS = 100_000, DAY_MS = 86_400_000;
/** Answered by the dozen (frame chunks, previews, idea polls): counted, and logged only when they fail or are slow. */
const QUIET = new Set(['/api/looks/:id/frames/:hash/:n', '/api/looks/:id/frames/:hash/manifest',
  '/api/looks/:id/preview/:name', '/api/ideas/:id']);
/** Held open up to 25 s by design (SPEC "HTTP API"), so never slow. */
const POLL = '/api/ideas/:id';

/** A day's counts, and what tells its visitors and people apart (dropped when the day ends). */
type Day = StatsDay & { end: number, salt: Buffer, seen: Set<string>, members: Set<string> };
const newDay = (now: Date): Day => ({ day: now.toLocaleDateString('en-CA'), visitors: 0, people: 0, views: 0,
  requests: 0, errors: 0, slow: 0, end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime(),
  salt: randomBytes(16), seen: new Set(), members: new Set() });

/** A path without its query (which may carry secrets), printable and short: it is written to the journal. */
const pathOf = (url: string) => url.split('?')[0]!.replace(/[^\x21-\x7e]/g, '?').slice(0, 80);
const sizeOf = (n: unknown) => {
  const b = Number(n);
  return n === undefined || !Number.isFinite(b) ? '-' : b < 1024 ? `${b}B` : `${(b / 1024).toFixed(1)}KB`;
};

/**
 * The stats and the request log. `trustProxy`: the request came through the tunnel, whose Cloudflare country header
 * (untrusted, two letters or nothing) is logged with it.
 */
export function createStats({ log, store, ideas = true, trustProxy = false }: { log: Log,
  store: Pick<Store, 'ideas' | 'looks'>, ideas?: boolean, trustProxy?: boolean }) {
  const startedAt = new Date().toISOString();
  const days: Day[] = [];
  const slowest: ServerStats['slowest'] = [];
  const today = () => {
    const now = Date.now();
    if (!days[0] || now >= days[0].end) {
      days.unshift(newDay(new Date(now)));
      days.length = Math.min(days.length, DAYS);
      days[1]?.seen.clear();
      days[1]?.members.clear();
    }
    return days[0]!;
  };
  // A visitor is their address and browser hashed with today's random salt, which is never written anywhere: it
  // tells one visit from another today, and nothing about who it was or whether they came yesterday.
  const visitorOf = (req: FastifyRequest, salt: Buffer) => createHash('sha256').update(salt)
    .update(`${req.ip}|${String(req.headers['user-agent'] ?? '').slice(0, 256)}`).digest('hex').slice(0, 8);

  async function onResponse(req: FastifyRequest, reply: FastifyReply) {
    const d = today(), status = reply.statusCode, ms = Math.round(reply.elapsedTime);
    const api = /^\/api(?:\/|$)/.test(req.url);
    const route = api && req.routeOptions.url ? req.routeOptions.url : pathOf(req.url);
    d.requests++;
    if (status >= 500) d.errors++;
    const slow = ms >= SLOW_MS && route !== POLL;
    if (slow) {
      d.slow++;
      slowest.unshift({ at: new Date().toISOString(), method: req.method, route, status, ms });
      slowest.length = Math.min(slowest.length, SLOWEST);
    }
    if (req.user && !d.members.has(req.user.id)) d.people = d.members.add(req.user.id).size;
    // A page is the app's shell: a path of the app's own, not a file (the sandbox page is HTML too), or its 304.
    const page = req.method === 'GET' && !api && !/\.[^/]*$/.test(route) && (status === 304
      || (status === 200 && String(reply.getHeader('content-type') ?? '').startsWith('text/html')));
    if (!page && !slow && status < 400 && (QUIET.has(route) || !api)) return;
    const visitor = visitorOf(req, d.salt);
    if (page) {
      d.views++;
      if (d.seen.size < MAX_VISITORS && !d.seen.has(visitor)) d.visitors = d.seen.add(visitor).size;
    }
    const country = trustProxy ? String(req.headers['cf-ipcountry'] ?? '') : '';
    log.info(`[http] ${req.method} ${route} ${status} ${ms}ms ${sizeOf(reply.getHeader('content-length'))} `
      + `v=${visitor}${/^[A-Z]{2}$/.test(country) ? ` ${country}` : ''}`);
  }

  function read(): ServerStats {
    today();
    const since = Date.now() - DAY_MS, recent = (at?: string) => !!at && Date.parse(at) >= since;
    const bakes = { done: 0, failed: 0, waiting: 0 };
    for (const { bake } of store.looks.list((l) => l.bake)) {
      if (bake!.status === 'queued' || bake!.status === 'running') bakes.waiting++;
      else if (recent(bake!.checkedAt)) bakes[bake!.status === 'failed' || !bake!.ok ? 'failed' : 'done']++;
    }
    const memory = process.memoryUsage();
    return { startedAt, uptime: Math.round(process.uptime()), memory: { rss: memory.rss, heap: memory.heapUsed },
      load: os.loadavg()[0]!, slowest: [...slowest],
      days: days.map(({ end: _e, salt: _s, seen: _v, members: _m, ...d }) => d),
      bakes, ...(ideas ? { ideas: ideaCounts(store, recent) } : {}) };
  }

  return { onResponse, read, routes: { 'GET /admin/stats': forAdmins(async () => read()) } };
}

/** Ideas and refinements made in the last 24 hours, those that failed, and those queued or generating now. */
function ideaCounts(store: Pick<Store, 'ideas'>, recent: (at?: string) => boolean) {
  const counts = { made: 0, failed: 0, waiting: 0 };
  for (const idea of store.ideas.list()) {
    if (isPending(idea)) counts.waiting++;
    if (!recent(idea.createdAt)) continue;
    counts.made++;
    if (idea.status === 'failed') counts.failed++;
  }
  return counts;
}
