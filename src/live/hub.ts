// The live stage's sockets (SPEC-live "Socket"): one state, kept in <data>/live.json; every change broadcast as one
// JSON string to every open socket; pings answered with the server's clock; presence; limits per socket. While /pi's
// engine drives the stage (its last control used was /pi's), what it plays goes to every socket instead.
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { WebSocket } from 'ws';

import {
  FromClient, type FromServer, type Live, type LiveLook, type PiNow, type PiSource, SavedLive,
} from '../../shared/schemas/live.ts';
import { serverNow } from '../clock.ts';
import type { Logger } from '../http.ts';
import { applySet, emptyLive, switchTo } from './state.ts';

export const MAX_SOCKETS = 200;
const RATE = 30, BURST = 60, SWITCH_MS = 2000, KEEPALIVE_MS = 25_000, PRESENT_MS = 30_000, SAVE_MS = 1000;
const MAX_BUFFERED = 1 << 20;      // a socket this far behind is dropped rather than queued for
const PI_ANCHOR_MS = 2000;         // /pi's show time goes out at least this often while nothing else changes
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
    // A file from before a field was added takes that field's default.
    const raw: unknown = JSON.parse(await fsp.readFile(file, 'utf8'));
    const saved = SavedLive.safeParse(raw?.constructor === Object ? { ...emptyLive(), ...raw } : raw);
    if (saved.success) live = saved.data as Live;
    else {
      const issue = saved.error.issues[0]!;
      log.warn?.(`live: live.json is not a stage's state (${issue.path.join('.')}: ${issue.message}); starting empty`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn?.('live: could not read live.json:', err);
  }
  const clients = new Set<Client>(), seen = new Map<string, number>();
  let saveTimer: NodeJS.Timeout | null = null, presenceKey = '';
  let piNow: PiNow | null = null, piSource: PiSource | null = null, piKey = '', piSentAt = 0;
  const drivers = new Set<(from: Live['driver']) => void>();

  /** Written whole to a temporary, then renamed over live.json: a stop mid-write leaves the last state. */
  const write = () => {
    const tmp = `${file}.${process.pid}.tmp`;
    return fsp.writeFile(tmp, JSON.stringify(live)).then(() => fsp.rename(tmp, file))
      .catch((err) => log.error?.('live: could not save live.json:', err));
  };
  const save = () => {
    saveTimer ??= setTimeout(() => {
      saveTimer = null;
      void write();
    }, SAVE_MS);
  };
  const send = (c: Client, text: string) => {
    if (c.ws.readyState !== 1) return;
    if (c.ws.bufferedAmount > MAX_BUFFERED) { c.ws.terminate(); return; }
    c.ws.send(text);
  };
  const say = (c: Client, msg: FromServer) => send(c, JSON.stringify(msg));
  const all = (msg: FromServer) => { const text = JSON.stringify(msg); for (const c of clients) send(c, text); };
  const piMsg = (source: boolean): FromServer => ({ type: 'pi', at: serverNow(), now: piNow,
    ...(source && piSource ? { source: piSource } : {}) });
  const state = (c: Client) => {
    say(c, { type: 'state', live, now: serverNow(), control: c.control });
    if (live.driver === 'pi') say(c, piMsg(true));
  };
  /** Who drives the stage now; a change goes to every socket as a whole state. */
  function drive(from: Live['driver']) {
    if (live.driver === from) return;
    live = { ...live, driver: from, rev: live.rev + 1, updatedAt: Date.now() };
    for (const c of clients) state(c);
    for (const fn of drivers) fn(from);
    save();
  }
  function presence(force = false) {
    const now = serverNow();
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
    const now = serverNow();
    if (!allowed(c, now)) return;
    let parsed;
    try { parsed = FromClient.safeParse(JSON.parse(String(data))); } catch { parsed = null; }
    if (!parsed?.success) return say(c, { type: 'error', error: 'That message is not one the stage takes.' });
    const msg = parsed.data;
    if (msg.type === 'ping') return say(c, { type: 'pong', id: msg.id, now: serverNow() });
    if (msg.type === 'sync') return state(c);
    if (!c.control) return say(c, { type: 'error', error: 'Only controllers can change the stage.' });
    seen.set(c.who.username, now);
    const took = live.driver === 'pi';           // a controller's change takes the stage back from /pi
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
      if (took) { live.driver = 'stage'; for (const x of clients) state(x); } else all(update);
    }
    if (took) for (const fn of drivers) fn('stage');
    live.updatedAt = Date.now();                 // stored: the wall clock; show times run on serverNow()
    save();
    presence();
  }

  return {
    get live() { return live; },
    get size() { return clients.size; },
    /** /pi's engine was used: it drives the stage from now on, until a controller's next change. */
    piDrove: () => drive('pi'),
    /** fn(driver) at each change of who drives. Returns its removal. */
    onDriver(fn: (from: Live['driver']) => void) { drivers.add(fn); return () => { drivers.delete(fn); }; },
    /** What /pi's engine plays now (null: nothing, or it is down); sent on while it drives, when it changed. */
    piNow(now: PiNow | null) {
      piNow = now;
      if (live.driver !== 'pi') return;
      const key = JSON.stringify(now && { ...now, t: 0 }), at = serverNow();
      if (key === piKey && at - piSentAt < PI_ANCHOR_MS) return;
      piKey = key;
      piSentAt = at;
      all(piMsg(false));
    },
    /** What /pi's engine switched to (or how its automation changed). */
    piSource(source: PiSource) {
      piSource = source;
      piKey = '';
      if (live.driver === 'pi') all(piMsg(true));
    },
    /** A socket that passed the session and origin checks. */
    join(ws: WebSocket, who: Who, control: boolean) {
      if (clients.size >= MAX_SOCKETS) { ws.close(1013, 'The stage is full.'); return; }
      const c: Client = { ws, who, control, tokens: BURST, at: serverNow(), over: 0, switchedAt: 0, warned: false };
      clients.add(c);
      ws.on('message', (data) => {
        try { onMessage(c, data); } catch (err) {
          log.error?.('live: a message failed:', err);
          say(c, { type: 'error', error: 'The stage could not take that: try again.' });
        }
      });
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
        await write();
      }
    },
  };
}
export type Hub = Awaited<ReturnType<typeof createHub>>;
