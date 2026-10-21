// /pi's engine as the live stage follows it (SPEC-live "Following /pi"): one socket from this server to the dry run at
// PI_PREVIEW_URL (on this machine), saying hello as its page does, turning what it sends into the stage's PiNow and
// PiSource. It reconnects after 1 s, doubling to 10 s. It connects nowhere else, and never to the Pi itself.
// It is also how Studio plays a look on the lights (src/lights.ts): its `send`, with PI_PIN in its hello.
import WebSocket from 'ws';

import type { PiNow, PiQueued, PiSource } from '../../shared/schemas/live.ts';

const FIRST_WAIT_MS = 1000, MAX_WAIT_MS = 10_000;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const KINDS = new Set(['look', 'live', 'baked']);
/** The engine's queue as viewers see it: titles, kinds and who added each, at most 20. */
const queueOf = (q: unknown): PiQueued[] => (Array.isArray(q) ? q : []).slice(0, 20)
  .filter((i) => i && typeof i.title === 'string' && KINDS.has(i.kind))
  .map((i) => ({ title: i.title.slice(0, 200), kind: i.kind,
    ...typeof i.by === 'string' ? { by: i.by.slice(0, 64) } : {} }));
type Look = { rev: number, t: number, bpm: number, beat0: number, offset: number, paces?: Record<string, unknown>,
  controls: { name: string, value: number | string, kind: string }[] };

/** The engine's state message → PiNow (null: nothing plays), or undefined if it is not one. */
export function piNowOf(state: { look?: Look | null, gain?: number, queue?: unknown } | null)
  : PiNow | null | undefined {
  if (!state || !num(state.gain)) return undefined;
  const l = state.look;
  if (!l) return null;
  if (![l.rev, l.t, l.bpm, l.beat0, l.offset].every(num) || !Array.isArray(l.controls)) return undefined;
  const values = Object.fromEntries(l.controls
    .filter((c): c is typeof c & { value: number } => c.kind !== 'bpm' && num(c.value))
    .map((c) => [String(c.name), c.value]));
  const paces = Object.fromEntries(Object.entries(l.paces && typeof l.paces === 'object' ? l.paces : {})
    .filter((e): e is [string, number] => num(e[1])));
  return { rev: l.rev, t: l.t, bpm: l.bpm, beat0: l.beat0, offset: l.offset,
    ...Object.keys(paces).length ? { paces } : {}, values, gain: state.gain,
    ...Array.isArray(state.queue) && state.queue.length ? { queue: queueOf(state.queue) } : {} };
}

/** `pin`: the engine's PIN (PI_PIN), said in the hello; `log`: what the engine refuses of Studio's sends. */
export function piFeed({ target, base = '/pi', pin, onNow, onSource, log = console }: { target: URL, base?: string,
  pin?: string, onNow: (now: PiNow | null) => void, onSource: (source: PiSource) => void,
  log?: { warn?: (...a: unknown[]) => void } }) {
  const url = `${target.protocol === 'https:' ? 'wss:' : 'ws:'}//${target.host}${base}/ws`;
  let ws: WebSocket | null = null, wait = FIRST_WAIT_MS, timer: NodeJS.Timeout | null = null, alive = true;
  // ok: the engine took the hello (its PIN); queued: its queue's length, from its last state.
  let ok = false, queued = 0;
  function connect() {
    timer = null;
    // The engine takes its own page's origin only: this one, as it sees the request.
    const s = ws = new WebSocket(url, { origin: target.origin, maxPayload: 1 << 20, handshakeTimeout: 5000 });
    s.on('open', () => {
      wait = FIRST_WAIT_MS;
      s.send(JSON.stringify({ type: 'hello', feed: true, ...pin ? { pin } : {} }));
    });
    s.on('message', (d) => {
      let m;
      try { m = JSON.parse(String(d)); } catch { return; }
      if (m?.type === 'hello') ok = m.ok === true;
      else if (m?.type === 'error' && typeof m.error === 'string') log.warn?.(`[pi] ${m.error.slice(0, 200)}`);
      else if (m?.type === 'source' && m.source && num(m.source.rev) && Array.isArray(m.source.layers)) {
        onSource(m.source);
      }
      else if (m?.type === 'state') {
        queued = Array.isArray(m.state?.queue) ? m.state.queue.length : 0;
        const now = piNowOf(m.state);
        if (now !== undefined) onNow(now);
      }
    });
    s.on('error', () => s.terminate());
    s.on('close', () => {
      if (ws !== s) return;
      ws = null;
      ok = false;
      onNow(null);
      if (alive) timer = setTimeout(connect, wait);
      wait = Math.min(MAX_WAIT_MS, wait * 2);
    });
  }
  connect();
  return {
    /** The engine is there and took the hello. */
    connected: () => ok && ws?.readyState === WebSocket.OPEN,
    /** How many items its queue holds, as it last said. */
    queued: () => queued,
    /** One message to the engine (a `send`): false if it is not connected. */
    send(msg: object) {
      if (!ok || ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    close() {
      alive = false;
      if (timer) clearTimeout(timer);
      ws?.terminate();
    },
  };
}
