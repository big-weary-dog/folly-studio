// The live stage's sockets (SPEC-live "Socket"): one state, kept in <data>/live.json; every change broadcast as one
// JSON string to every open socket; pings answered with the server's clock; presence; limits per socket.
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { WebSocket } from 'ws';

import { FromClient, type FromServer, type Live, type LiveLook } from '../../shared/schemas/live.ts';
import type { Logger } from '../http.ts';
import { applySet, emptyLive, switchTo } from './state.ts';

export const MAX_SOCKETS = 200;
const RATE = 30, BURST = 60, SWITCH_MS = 2000, KEEPALIVE_MS = 25_000, PRESENT_MS = 30_000, SAVE_MS = 1000;
const MAX_BUFFERED = 1 << 20;      // a socket this far behind is dropped rather than queued for
type Who = { id: string, username: string };
type Client = { ws: WebSocket, who: Who, control: boolean, tokens: number, at: number, over: number,
  switchedAt: number, warned: boolean };
type Meter = Pick<Client, 'tokens' | 'at' | 'over' | 'warned'>;
/** A socket's token bucket at `now` (ms), a message in: ok, or dropped (warn: the first of a run). Dropped ones leak
 * away at 4 × RATE, so a refilled token forgives nothing; past 2 s of that (far over it) closes the socket, however
 * the messages are spaced. */
export function meter(c: Meter, now: number): 'ok' | 'drop' | 'warn' | 'close' {
  const dt = (now - c.at) / 1000;
  c.tokens = Math.min(BURST, c.tokens + dt * RATE);
  c.over = Math.max(0, c.over - dt * RATE * 4);
  c.at = now;
  if (c.tokens >= 1) { c.tokens--; if (!c.over) c.warned = false; return 'ok'; }
  if (++c.over > RATE * 4 * 2) return 'close';
  if (c.warned) return 'drop';
  c.warned = true;
  return 'warn';
}

/** Finds a look a controller may play, as the stage copies it, or says why not. */
export type Playable = (lookId: string) => LiveLook | { error: string };

export async function createHub({ dataDir, playable, log = console }: { dataDir: string, playable: Playable,
  log?: Logger }) {
  const file = path.join(dataDir, 'live.json');
  let live = emptyLive();
  try {
    const saved = JSON.parse(await fsp.readFile(file, 'utf8')) as Live;
    if (saved && typeof saved.rev === 'number') live = { ...emptyLive(), ...saved };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn?.('live: could not read live.json:', err);
  }
  const clients = new Set<Client>(), seen = new Map<string, number>();
  let saveTimer: NodeJS.Timeout | null = null, presenceKey = '';

  const save = () => {
    saveTimer ??= setTimeout(() => {
      saveTimer = null;
      const tmp = `${file}.${process.pid}.tmp`;
      fsp.writeFile(tmp, JSON.stringify(live)).then(() => fsp.rename(tmp, file))
        .catch((err) => log.error?.('live: could not save live.json:', err));
    }, SAVE_MS);
  };
  const send = (c: Client, text: string) => {
    if (c.ws.readyState !== 1) return;
    if (c.ws.bufferedAmount > MAX_BUFFERED) { c.ws.terminate(); return; }
    c.ws.send(text);
  };
  const say = (c: Client, msg: FromServer) => send(c, JSON.stringify(msg));
  const all = (msg: FromServer) => { const text = JSON.stringify(msg); for (const c of clients) send(c, text); };
  const state = (c: Client) => say(c, { type: 'state', live, now: Date.now(), control: c.control });
  function presence(force = false) {
    const now = Date.now();
    for (const [name, at] of seen) if (now - at > PRESENT_MS) seen.delete(name);
    const controllers = [...seen.keys()].sort(), key = `${clients.size}|${controllers.join(',')}`;
    if (force || key !== presenceKey) all({ type: 'presence', viewers: clients.size, controllers });
    presenceKey = key;
  }
  const keepalive = setInterval(() => {
    for (const c of clients) if (c.ws.readyState === 1) c.ws.ping();
    presence();
  }, KEEPALIVE_MS);
  keepalive.unref();

  function allowed(c: Client, now: number) {
    const v = meter(c, now);
    if (v === 'close') c.ws.close(1008, 'Too many messages.');
    else if (v === 'warn') say(c, { type: 'error', error: 'Too many changes at once: slow down.' });
    return v === 'ok';
  }

  function onMessage(c: Client, data: unknown) {
    const now = Date.now();
    if (!allowed(c, now)) return;
    let parsed;
    try { parsed = FromClient.safeParse(JSON.parse(String(data))); } catch { parsed = null; }
    if (!parsed?.success) return say(c, { type: 'error', error: 'That message is not one the stage takes.' });
    const msg = parsed.data;
    if (msg.type === 'ping') return say(c, { type: 'pong', id: msg.id, now: Date.now() });
    if (msg.type === 'sync') return state(c);
    if (!c.control) return say(c, { type: 'error', error: 'Only controllers can change the stage.' });
    seen.set(c.who.username, now);
    if (msg.type === 'play') {
      if (now - c.switchedAt < SWITCH_MS) return say(c, { type: 'error', error: 'One look every 2 seconds.' });
      const look = playable(msg.lookId);
      if ('error' in look) return say(c, { type: 'error', error: look.error });
      c.switchedAt = now;
      live = switchTo(live, look, c.who, now);
      for (const x of clients) state(x);
    } else {
      const update = applySet(live, msg, c.who, now);
      if ('error' in update) return say(c, { type: 'error', error: update.error });
      all(update);
    }
    save();
    presence();
  }

  return {
    get live() { return live; },
    get size() { return clients.size; },
    /** A socket that passed the session and origin checks. */
    join(ws: WebSocket, who: Who, control: boolean) {
      if (clients.size >= MAX_SOCKETS) { ws.close(1013, 'The stage is full.'); return; }
      const c: Client = { ws, who, control, tokens: BURST, at: Date.now(), over: 0, switchedAt: 0, warned: false };
      clients.add(c);
      ws.on('message', (data) => onMessage(c, data));
      ws.on('close', () => { clients.delete(c); presence(); });
      ws.on('error', () => ws.terminate());
      state(c);
      presence(true);
    },
    async close() {
      clearInterval(keepalive);
      for (const c of clients) c.ws.close(1001, 'The server is restarting.');
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        await fsp.writeFile(file, JSON.stringify(live)).catch(() => {});
      }
    },
  };
}
export type Hub = Awaited<ReturnType<typeof createHub>>;
