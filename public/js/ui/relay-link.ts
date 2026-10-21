// Relay to the lights (SPEC-live "Relay to the lights"): this browser renders and the engine plays its frames. Its own
// socket to /pi/ws holds the lease; a driver says which runtime renders (the Live tab's own sandbox of the engine's
// look, or the editor's preview) and the Worker's word at each state. The Worker renders ahead on its own timer at the
// engine's slots; each frame goes on to the engine, or is dropped when the socket is behind. It keeps the screen awake
// while relaying, and says the buffer, the misses and who holds the lease.
import { signal } from '@preact/signals';

import type { FromPage, PiState, ToPage } from '../../../pi/page/socket.ts';
import type { PiSource } from '../../../shared/schemas/live.ts';
import type { RelayCfg } from '../relay-ahead.ts';
import type { Runtime } from '../runtime.ts';

export const BUFFERS = [80, 200, 400, 800];     // ms the browser renders ahead
const PIN_KEY = 'studio-pi-pin', CLOCK_KEEP_MS = 10_000, RETRY_MS = 2000, BEHIND = 1 << 18;
export const epoch = () => performance.timeOrigin + performance.now();

/** The slot playing at epoch ms `at`: each reading run on at fps, the furthest ahead of the last 10 s (each reaches
 * here late, never early). */
export function slotClock(fps: number) {
  const seen: { at: number, index: number }[] = [];
  return {
    see(index: number, at = epoch()) {
      seen.push({ at, index });
      while (seen.length && seen[0]!.at < at - CLOCK_KEEP_MS) seen.shift();
    },
    at: (at = epoch()) => seen.reduce((m, s) => Math.max(m, s.index + (at - s.at) * fps / 1000), -Infinity),
    reset() { seen.length = 0; },
  };
}

/** The engine's slot clock and the buffer in slots, as every word to the Worker carries them. */
export type RelayBase = { index: number, at: number, fps: number, lead: number };
export type RelayDriver = {
  /** Frames over whatever the engine plays (the editor's), not in place of its look. */
  over?: boolean,
  /** Ready to render: the runtime that renders ahead and the rig's count and fps, or why not. */
  begin(): Promise<{ runtime: Runtime, count: number, fps: number } | string>,
  /** The Worker's word at state `s` while holding the lease, or null to render nothing (the engine plays its own). */
  word(s: PiState, base: RelayBase): Partial<RelayCfg> | null,
  /** The engine's other news (the source it plays). */
  message?(m: { type: string, source?: PiSource }): void,
  /** Relaying ended (or the socket was opened anew): let go of what begin took, or forget what was sent. */
  end(runtime: Runtime): void,
  reset?(): void,
};

export function createRelayLink(driver: RelayDriver) {
  const on = signal(false), holding = signal(false), error = signal(''), by = signal<string | null>(null);
  const ahead = signal(0), misses = signal(0), awake = signal<'yes' | 'no' | 'unsupported'>('no');
  const buffer = signal(200);
  let ws: WebSocket | null = null, runtime: Runtime | null = null, last: PiState | null = null;
  let frameBytes = 0, fps = 40, retry = 0, lock: WakeLockSentinel | null = null, clock = slotClock(fps);

  const send = (m: FromPage) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  const lease = () => send({ type: 'relay-start', ...driver.over ? { over: true } : {} });
  /** The Worker's word from the latest state: at each state, and when the driver's own clock moves. */
  function nudge() {
    if (!holding.peek() || !last?.relay || !runtime) return;
    const base = { index: clock.at(), at: epoch(), fps, lead: Math.round(buffer.peek() * fps / 1000) };
    runtime.relay(driver.word(last, base) ?? { on: false });
  }
  function onState(s: PiState) {
    by.value = s.relay?.by ?? null;
    last = s;
    if (!holding.peek() || !s.relay) return;
    ahead.value = Math.round(s.relay.ahead * 1000 / fps);
    misses.value = s.relay.misses;
    clock.see(s.relay.index);
    nudge();
  }
  function onMessage(m: ToPage | { type: 'source', source: PiSource }) {
    if (m.type === 'hello') {
      if (m.ok) lease();
      else error.value = m.error ?? 'The lights ask for their PIN: say it on the lights\' page first.';
    } else if (m.type === 'relay') {
      holding.value = m.holding;
      if (m.holding) { error.value = ''; return; }
      runtime?.relay({ on: false });
      // The flash guard ended it: off until someone turns it on again, never back on its own.
      if (m.error && /flash guard/.test(m.error)) { stop(); error.value = m.error; return; }
      if (m.error) error.value = m.error;
      // Taken back as soon as the link allows, while it is on (it ends on its own after a second with no frames).
      if (on.peek() && !retry) retry = window.setTimeout(() => { retry = 0; if (on.peek()) lease(); }, RETRY_MS);
    } else if (m.type === 'state') onState(m.state);
    else driver.message?.(m);
  }

  function open() {
    const url = new URL('/pi/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const s = ws = new WebSocket(url);
    s.binaryType = 'arraybuffer';
    s.onopen = () => {
      let pin = '';
      try { pin = sessionStorage.getItem(PIN_KEY) ?? ''; } catch { /* private mode */ }
      send({ type: 'hello', ...pin ? { pin } : {} });
    };
    s.onmessage = (e) => { if (typeof e.data === 'string') onMessage(JSON.parse(e.data)); };
    s.onclose = () => {
      if (ws !== s) return;
      holding.value = false;
      runtime?.relay({ on: false });
      if (on.peek()) { error.value = 'Lost the lights: trying again…'; retry ||= window.setTimeout(reopen, RETRY_MS); }
    };
  }
  const reopen = () => { retry = 0; if (on.peek()) { driver.reset?.(); clock.reset(); open(); } };

  async function wake() {
    if (!('wakeLock' in navigator)) { awake.value = 'unsupported'; return; }
    try {
      lock = await navigator.wakeLock.request('screen');
      awake.value = 'yes';
      lock.addEventListener('release', () => { awake.value = 'no'; });
    } catch { awake.value = 'no'; }
  }
  // A wake lock lets go when the tab is hidden; taken again when it is back.
  const visible = () => {
    if (on.peek() && document.visibilityState === 'visible' && awake.peek() !== 'yes') void wake();
  };

  async function start() {
    on.value = true;
    error.value = '';
    const got = await driver.begin().catch((e: Error) => e.message);
    if (typeof got === 'string' || !on.peek()) {
      if (typeof got === 'string') error.value = got;
      else driver.end(got.runtime);
      on.value = false;
      return;
    }
    runtime = got.runtime;
    fps = got.fps;
    clock = slotClock(fps);
    frameBytes = 8 + got.count * 6;
    // A frame from the sandbox is untrusted: exactly a frame's size, or dropped.
    runtime.onRelayed = (bytes) => {
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== frameBytes || !holding.peek()) return;
      if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < BEHIND) ws.send(bytes);
    };
    document.addEventListener('visibilitychange', visible);
    void wake();
    open();
  }

  function stop() {
    on.value = false;
    send({ type: 'relay-stop' });
    clearTimeout(retry);
    retry = 0;
    const s = ws;
    ws = null;
    s?.close();
    if (runtime) {
      runtime.relay({ on: false });
      runtime.onRelayed = undefined;
      driver.end(runtime);
    }
    runtime = null;
    last = null;
    holding.value = false;
    document.removeEventListener('visibilitychange', visible);
    void lock?.release().catch(() => {});
    lock = null;
    awake.value = 'no';
  }

  return { on, holding, error, by, ahead, misses, awake, buffer, start, stop, nudge,
    toggle() { if (on.peek()) stop(); else void start(); } };
}
export type Relay = ReturnType<typeof createRelayLink>;
