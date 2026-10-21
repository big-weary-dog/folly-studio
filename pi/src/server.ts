// The control page on the LAN (pi/README.md "The control page"): the page as built into pi/page/dist, and its socket
// at /ws, both under `base` when one is given (/pi/ and /pi/ws behind Studio's proxy, docs/HOSTING.md). A socket must
// come from the page's own origin; with a PIN set, it must say the PIN before anything it sends changes the lights.
// Each socket is rate-limited as the live stage's are; the state goes to every socket ~10 a second, and what plays
// (the source, for Studio's Live tab) when it changes.
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';

import { meter } from '../../src/live/hub.ts';
import type { Engine } from './engine.ts';
import { FromPage, type PiState, type ToPage } from './protocol.ts';

export const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
  + "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const STATE_MS = 100, PIN_TRIES = 5, PIN_LOCK_MS = 60_000, MAX_SOCKETS = 32;
const DIST = fileURLToPath(new URL('../page/dist', import.meta.url));

/** `watching`: said hello as a page (not Studio's feed, which follows for /live and is no one watching). */
type Client = { ws: WebSocket, ok: boolean, watching: boolean, tokens: number, at: number, over: number,
  warned: boolean };
export type ServerOptions = { engine: Engine, state: () => PiState, pin: string, port: number, host: string,
  base?: string, dist?: string, log?: (line: string) => void, now?: () => number };

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function controlServer(o: ServerOptions) {
  const log = o.log ?? (() => {}), now = o.now ?? (() => performance.now());
  const app = Fastify({ logger: false, bodyLimit: 1024 });
  const clients = new Set<Client>();
  let fails = 0, lockedUntil = 0;
  app.addHook('onSend', async (_req, reply) => {
    reply.headers({ 'content-security-policy': CSP, 'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer', 'cache-control': 'no-cache' });
  });
  const base = o.base ?? '';
  await app.register(fastifyStatic, { root: o.dist ?? DIST, prefix: `${base}/`, dotfiles: 'ignore',
    cacheControl: false });
  // /pi to /pi/, so the page's relative URLs (its script, its socket) land under the base.
  if (base) app.get(base, (_req, reply) => reply.redirect(`${base}/`, 301));
  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 } });

  const say = (c: Client, m: ToPage) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };
  /** A PIN said on a socket: right, wrong, or (after PIN_TRIES wrong ones in a row) locked out for a minute. */
  function pinOk(pin: string | undefined) {
    if (!o.pin) return { ok: true };
    if (now() < lockedUntil) return { ok: false, error: 'Too many wrong PINs: wait a minute.' };
    if (pin !== undefined && same(pin, o.pin)) { fails = 0; return { ok: true }; }
    if (pin === undefined) return { ok: false };
    if (++fails >= PIN_TRIES) { fails = 0; lockedUntil = now() + PIN_LOCK_MS; log('control page: PIN locked'); }
    return { ok: false, error: 'Wrong PIN.' };
  }

  function onMessage(c: Client, data: unknown) {
    const m = meter(c, now());
    if (m === 'close') { c.ws.close(1008, 'Too many messages'); return; }
    if (m !== 'ok') { if (m === 'warn') say(c, { type: 'error', error: 'Slow down.' }); return; }
    let r: ReturnType<typeof FromPage.safeParse> | null = null;
    try { r = FromPage.safeParse(JSON.parse(String(data))); } catch { r = null; }
    if (!r?.success) { say(c, { type: 'error', error: 'Not a message this page sends.' }); return; }
    const msg = r.data;
    if (msg.type === 'hello') {
      const p = pinOk(msg.pin);
      c.ok = p.ok;
      c.watching = !msg.feed;
      say(c, { type: 'hello', ok: p.ok, needPin: !!o.pin, ...(p.error ? { error: p.error } : {}) });
      if (p.ok) say(c, { type: 'state', state: o.state() });
      const source = o.engine.source();
      if (p.ok && source) say(c, { type: 'source', source });
      return;
    }
    if (!c.ok) { say(c, { type: 'error', error: 'Say the PIN first.' }); return; }
    const e = o.engine;
    if (msg.type === 'play' && !e.play(msg.id)) say(c, { type: 'error', error: `${msg.id} cannot play.` });
    else if (msg.type === 'set' && !e.set(msg.name, msg.value)) say(c, { type: 'error', error: `No ${msg.name}.` });
    else if (msg.type === 'tap') e.tap(msg.at);
    else if (msg.type === 'level') e.level(msg.value);
    else if (msg.type === 'blackout') e.blackout(msg.on);
  }

  const host = (h: string) => h.toLowerCase().replace(/:80$/, '');
  app.get(`${base}/ws`, {
    websocket: true,
    // Browsers always send Origin on a socket: only this page's own may drive the lights (CSRF over WebSockets).
    preValidation: async (req, reply) => {
      let from = '';
      try { from = new URL(String(req.headers.origin)).host; } catch { /* missing or "null" */ }
      if (!from || host(from) !== host(req.host)) return reply.code(403).send('Cross-origin socket refused.');
      if (clients.size >= MAX_SOCKETS) return reply.code(503).send('Too many pages open.');
    },
  }, (ws) => {
    const c: Client = { ws, ok: false, watching: false, tokens: 60, at: now(), over: 0, warned: false };
    clients.add(c);
    ws.on('message', (d) => onMessage(c, d));
    ws.on('close', () => clients.delete(c));
    ws.on('error', () => ws.terminate());
  });

  let sent: object | null = null;
  const timer = setInterval(() => {
    if (!clients.size) return;
    // The source when it changed (a switch, a push off a lane), then the state.
    const source = o.engine.source(), fresh = source !== sent;
    sent = source;
    const src = source && fresh ? JSON.stringify({ type: 'source', source } satisfies ToPage) : '';
    const msg = JSON.stringify({ type: 'state', state: o.state() } satisfies ToPage);
    for (const c of clients) {
      if (!c.ok || c.ws.readyState !== 1 || c.ws.bufferedAmount >= 1 << 18) continue;
      if (src) c.ws.send(src);
      c.ws.send(msg);
    }
  }, STATE_MS);

  await app.listen({ port: o.port, host: o.host });
  const addr = app.server.address();
  return {
    port: typeof addr === 'object' && addr ? addr.port : o.port,
    clients: () => clients.size,
    /** Pages open: sockets that said hello, Studio's feed aside. */
    watching: () => [...clients].filter((c) => c.watching).length,
    async close() {
      clearInterval(timer);
      for (const c of clients) c.ws.terminate();
      await app.close();
    },
  };
}
