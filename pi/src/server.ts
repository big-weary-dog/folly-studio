// The control page on the LAN (pi/README.md "The control page"): the page as built into pi/page/dist, and its socket
// at /ws, and under `base` too when one is given (/pi/ and /pi/ws behind Studio's proxy, docs/HOSTING.md), so the ops
// hub's :4043/ reaches it either way. A socket must
// come from the page's own origin; with a PIN set, it must say the PIN before anything it sends changes the lights.
// Each socket is rate-limited as the live stage's are; the state goes to every socket ~10 a second, and what plays
// (the source, for Studio's Live tab) when it changes. What each may send in each mode: people.ts. Binary messages
// are relayed frames, taken only from the relay lease's holder (relay.ts).
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';

import { meter } from '../../src/live/hub.ts';
import type { Engine } from './engine.ts';
import { resolveLook, type Library, type PiLook } from './library.ts';
import { createPeople, PI_PAGE, type Who } from './people.ts';
import { type EngineState, FromPage, MAX_SEND, type Mode, type PiState, type ToPage } from './protocol.ts';
import type { Relay } from './relay.ts';

export const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
  + "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const STATE_MS = 100, PIN_TRIES = 5, PIN_LOCK_MS = 60_000, MAX_SOCKETS = 32;
const DIST = fileURLToPath(new URL('../page/dist', import.meta.url));

/** `who`: a page's person (null: Studio's feed, which follows for /live and is no one watching). */
type Client = { ws: WebSocket, ok: boolean, who: Who | null, tokens: number, at: number, over: number,
  warned: boolean };
type ServerOptions = { engine: Engine, lib: Library, state: () => EngineState, pin: string, port: number,
  host: string, mode?: Mode, relay?: Relay,
  base?: string, dist?: string, log?: (line: string) => void, now?: () => number };

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function controlServer(o: ServerOptions) {
  const log = o.log ?? (() => {}), now = o.now ?? (() => performance.now());
  const app = Fastify({ logger: false, bodyLimit: 1024 });
  const clients = new Set<Client>(), people = createPeople(o.mode ?? 'jukebox', now);
  let fails = 0, lockedUntil = 0;
  const pages = () => [...clients].filter((c) => c.ok && c.who);
  const state = (): PiState => ({ ...o.state(), ...people.state([...new Set(pages().map((c) => c.who!.name))]) });
  app.addHook('onSend', async (_req, reply) => {
    reply.headers({ 'content-security-policy': CSP, 'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer', 'cache-control': 'no-cache' });
  });
  const base = o.base ?? '';
  const files = { root: o.dist ?? DIST, dotfiles: 'ignore' as const, cacheControl: false };
  await app.register(fastifyStatic, { ...files, prefix: '/' });
  if (base) await app.register(fastifyStatic, { ...files, prefix: `${base}/`, decorateReply: false });
  // /pi to /pi/, so the page's relative URLs (its script, its socket) land under the base.
  if (base) app.get(base, (_req, reply) => reply.redirect(`${base}/`, 301));
  await app.register(fastifyWebsocket, { options: { maxPayload: Math.max(MAX_SEND, o.relay?.bytes ?? 0) } });
  o.relay?.onEnd((h, why) => say(h as Client, { type: 'relay', holding: false, ...why ? { error: why } : {} }));

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
    if (msg.type !== 'send' && String(data).length > 1024) { say(c, { type: 'error', error: 'Too long.' }); return; }
    if (msg.type === 'hello') {
      const p = pinOk(msg.pin);
      c.ok = p.ok;
      c.who = msg.feed ? null : msg.who ?? { name: PI_PAGE, drive: true };
      say(c, { type: 'hello', ok: p.ok, needPin: !!o.pin, ...(p.error ? { error: p.error } : {}),
        ...(c.who ? { you: c.who } : {}) });
      if (p.ok) say(c, { type: 'state', state: state() });
      const source = o.engine.source();
      if (p.ok && source) say(c, { type: 'source', source });
      return;
    }
    if (!c.ok) { say(c, { type: 'error', error: 'Say the PIN first.' }); return; }
    if (msg.type === 'relay-start' || msg.type === 'relay-stop') { relayLease(c, msg); return; }
    const no = people.check(c.who, msg);
    if (no) { say(c, { type: 'error', error: no }); return; }
    // Who did it, as the state says it (the Pi's own page queues as no one: it is everyone on site).
    const e = o.engine, by = c.who?.name ?? null, adder = by === PI_PAGE ? undefined : by ?? undefined;
    if (msg.type === 'play' && !e.play(msg.id, msg.fade)) say(c, { type: 'error', error: `${msg.id} cannot play.` });
    else if (msg.type === 'set' && !e.set(msg.name, msg.value)) say(c, { type: 'error', error: `No ${msg.name}.` });
    else if (msg.type === 'release') e.release(msg.name);
    else if (msg.type === 'palette' && !e.palette(msg.name)) say(c, { type: 'error', error: `No ${msg.name}.` });
    else if (msg.type === 'tap') e.tap(msg.at);
    else if (msg.type === 'level') e.level(msg.value);
    else if (msg.type === 'blackout') e.blackout(msg.on, by);
    else if (msg.type === 'queue' && !e.queue(msg.id, msg.at, adder, msg.fade)) {
      say(c, { type: 'error', error: `${msg.id} cannot queue.` });
    } else if (msg.type === 'unqueue') e.unqueue(msg.key);
    else if (msg.type === 'move') e.move(msg.key, msg.to);
    // In Jukebox every change is the full fade.
    else if (msg.type === 'next') e.next(people.mode === 'live' ? msg.fade : undefined);
    else if (msg.type === 'mode' && people.setMode(msg.mode)) e.jukebox();
    else if (msg.type === 'send') studioSent(c, msg);
  }

  /** The relay lease: for a page that may drive (never Studio's feed). */
  function relayLease(c: Client, { type, over }: { type: 'relay-start' | 'relay-stop', over?: boolean }) {
    if (type === 'relay-stop') { o.relay?.stop(c); say(c, { type: 'relay', holding: false }); return; }
    const no = !o.relay ? 'This engine takes no relay.' : !c.who?.drive ? 'Watching only: you may not relay.'
      // Over whatever plays, not while the guard holds the lights on safe: a look picked there lets it go.
      : over && o.state().tripped ? 'The flash guard tripped: pick a look on the lights first.'
      : o.relay.start(c, c.who.name, !!over);
    say(c, { type: 'relay', holding: !no, ...no ? { error: no } : {} });
    if (!no) log(`relay: ${c.who!.name} sends the frames`);
  }

  /** A relayed frame: the holder's alone, metered as other messages are for anyone else. */
  function onFrame(c: Client, data: Buffer) {
    const no = o.relay?.holds(c) ? o.relay.push(c, data) : 'Not relaying: send relay-start first.';
    if (!no) return;
    const m = meter(c, now());
    if (m === 'close') c.ws.close(1008, 'Too many messages');
    else if (m !== 'drop') say(c, { type: 'error', error: no });
  }

  /** A look Studio sent: its modules' code from our library by ref, never its own. */
  function studioSent(c: Client, msg: Extract<FromPage, { type: 'send' }>) {
    const { item } = msg;
    if (item.kind === 'baked') {
      if (!o.engine.sendBaked(item, msg.at, msg.by, msg.fade)) say(c, { type: 'error', error: 'The queue is full.' });
      return;
    }
    let look: PiLook;
    try { look = resolveLook(item.look as PiLook, o.lib); } catch (err) {
      say(c, { type: 'error', error: `Cannot play: ${(err as Error).message}` });
      return;
    }
    if (!o.engine.send(look, msg.at, msg.by, msg.fade)) say(c, { type: 'error', error: 'The queue is full.' });
  }

  const host = (h: string) => h.toLowerCase().replace(/:80$/, '');
  for (const at of new Set(['', base])) app.get(`${at}/ws`, {
    websocket: true,
    // Browsers always send Origin on a socket: only this page's own may drive the lights (CSRF over WebSockets).
    preValidation: async (req, reply) => {
      let from = '';
      try { from = new URL(String(req.headers.origin)).host; } catch { /* missing or "null" */ }
      if (!from || host(from) !== host(req.host)) return reply.code(403).send('Cross-origin socket refused.');
      if (clients.size >= MAX_SOCKETS) return reply.code(503).send('Too many pages open.');
    },
  }, (ws) => {
    const c: Client = { ws, ok: false, who: null, tokens: 60, at: now(), over: 0, warned: false };
    clients.add(c);
    ws.on('message', (d, binary) => (binary ? onFrame(c, d as Buffer) : onMessage(c, d)));
    ws.on('close', () => {
      clients.delete(c);
      o.relay?.stop(c);
      if (c.who) people.left(c.who.name, pages().some((x) => x.who!.name === c.who!.name));
    });
    ws.on('error', () => ws.terminate());
  });

  let sent: object | null = null;
  const timer = setInterval(() => {
    if (!clients.size) return;
    // The source when it changed (a switch, a push off a lane), then the state.
    const source = o.engine.source(), fresh = source !== sent;
    sent = source;
    const src = source && fresh ? JSON.stringify({ type: 'source', source } satisfies ToPage) : '';
    const msg = JSON.stringify({ type: 'state', state: state() } satisfies ToPage);
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
    watching: () => pages().length,
    async close() {
      clearInterval(timer);
      for (const c of clients) c.ws.terminate();
      await app.close();
    },
  };
}
