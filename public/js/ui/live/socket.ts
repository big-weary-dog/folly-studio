// The live stage's socket (SPEC-live "Socket"): the state and its updates, the server's clock (the ping with the
// shortest round trip of the last eight), presence, /pi's engine while it drives, and reconnecting after 0.5 s,
// doubling to 8 s, with jitter.
import { signal } from '@preact/signals';

import type { FromClient, FromServer, Live, LiveUpdate } from '../../../../shared/schemas/live.ts';
import { api, statusOf } from '../../api.ts';
import { signedOut } from '../session.ts';
import type { Pi } from './follow-pi.ts';
import { applyUpdate } from './lanes.ts';

const PINGS = 8, PING_GAP_MS = 120, RESYNC_MS = 30_000, FIRST_WAIT_MS = 500, MAX_WAIT_MS = 8000;

export function liveSocket() {
  const status = signal<'connecting' | 'open' | 'closed'>('connecting');
  const rev = signal(0);              // bumped on each change of `live`, for what renders it
  const control = signal(false), error = signal('');
  const presence = signal<{ viewers: number, controllers: string[] }>({ viewers: 0, controllers: [] });
  const clock = signal<{ offset: number, rtt: number } | null>(null);
  const pi = signal<Pi | null>(null);   // what /pi's engine plays, while it drives
  const sent = new Map<number, number>();
  let live: Live | null = null, ws: WebSocket | null = null, wait = FIRST_WAIT_MS, timer = 0, pingTimer = 0;
  let samples: { offset: number, rtt: number }[] = [], pingId = 0, fails = 0, alive = true;
  const listeners = new Set<(why: 'state' | 'pi' | LiveUpdate) => void>();

  const send = (msg: FromClient) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
  function pings() {
    clearTimeout(pingTimer);
    let n = 0;
    const one = () => {
      sent.set(++pingId, performance.now());
      send({ type: 'ping', id: pingId });
      pingTimer = window.setTimeout(++n < PINGS ? one : pings, n < PINGS ? PING_GAP_MS : RESYNC_MS);
    };
    one();
  }
  function onPong(id: number, now: number) {
    const at = sent.get(id);
    sent.delete(id);
    if (at === undefined) return;
    const rtt = performance.now() - at;
    samples = [...samples.slice(-(PINGS - 1)), { offset: now + rtt / 2 - Date.now(), rtt }];
    clock.value = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  }
  function onMessage(m: FromServer) {
    switch (m.type) {
      case 'pong': return onPong(m.id, m.now);
      case 'state':
        live = m.live;
        control.value = m.control;
        if (!clock.peek()) clock.value = { offset: m.now - Date.now(), rtt: Infinity };
        rev.value++;
        return listeners.forEach((fn) => fn('state'));
      case 'update':
        if (!live || !applyUpdate(live, m)) return send({ type: 'sync' });
        rev.value++;
        return listeners.forEach((fn) => fn(m));
      case 'pi':
        pi.value = { at: m.at, now: m.now, source: m.source ?? pi.peek()?.source ?? null };
        return listeners.forEach((fn) => fn('pi'));
      case 'presence': presence.value = { viewers: m.viewers, controllers: m.controllers }; return undefined;
      case 'error': error.value = m.error; return undefined;
      default: return undefined;
    }
  }
  function connect() {
    if (!alive) return;
    status.value = 'connecting';
    const s = ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/socket`);
    s.onopen = () => { status.value = 'open'; wait = FIRST_WAIT_MS; fails = 0; samples = []; pings(); };
    s.onmessage = (e) => { try { onMessage(JSON.parse(String(e.data))); } catch { /* not ours: ignored */ } };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      status.value = 'closed';
      clearTimeout(pingTimer);
      if (!alive) return;
      // A refused upgrade looks like any other drop: after a few, ask whether the session is still good.
      if (++fails === 3) api.me().catch((err) => { if (statusOf(err) === 401) { alive = false; signedOut(); } });
      timer = window.setTimeout(connect, wait * (0.75 + Math.random() / 2));
      wait = Math.min(MAX_WAIT_MS, wait * 2);
    };
  }
  connect();

  return {
    status, rev, control, error, presence, clock, pi,
    get live() { return live; },
    /** The server's time now, in epoch ms, as well as the pings tell. */
    now: () => Date.now() + (clock.peek()?.offset ?? 0),
    send,
    /** fn('state') on a new state, fn(update) on each update, fn('pi') on news of /pi. Returns its removal. */
    listen(fn: (why: 'state' | 'pi' | LiveUpdate) => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    close() {
      alive = false;
      clearTimeout(timer);
      clearTimeout(pingTimer);
      ws?.close();
      ws = null;
    },
  };
}
export type LiveSocket = ReturnType<typeof liveSocket>;
