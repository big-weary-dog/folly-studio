// Relay to the lights from the Live tab (SPEC-live "Relay to the lights"): this browser renders what the engine plays
// and the engine plays its frames. Its own socket to /pi/ws holds the lease; its own sandbox renders the engine's
// look (its source, code from our library by ref) ahead in the Worker, on the Worker's timer, at the engine's slots,
// as the states say them; each frame goes on to the engine, or is dropped when the socket is behind. It keeps the
// screen awake while relaying, and says the buffer, the misses and who holds the lease.
import { signal } from '@preact/signals';

import type { FromPage, PiState, ToPage } from '../../../../pi/page/socket.ts';
import type { PiSource } from '../../../../shared/schemas/live.ts';
import type { LiveSet } from '../../live-set.ts';
import { Runtime } from '../../runtime.ts';
import { loadLibrary, loadRig, normaliseLayers } from '../model.ts';
import { piExtra, piLayers } from './follow-pi.ts';

export const BUFFERS = [80, 200, 400, 800];     // ms the browser renders ahead
const PIN_KEY = 'studio-pi-pin', CLOCK_KEEP_MS = 10_000, RETRY_MS = 2000, BEHIND = 1 << 18;
type Look = NonNullable<PiState['look']>;
const epoch = () => performance.timeOrigin + performance.now();

/** What the engine has set on its look, from its state, for the Worker to set before each frame. */
export const relaySet = (l: Look): LiveSet => ({ bpm: l.bpm, beat0: l.beat0, offset: l.offset, paces: l.paces,
  values: Object.fromEntries(l.controls.filter((c) => c.kind === 'macro').map((c) => [c.name, c.value as number])) });

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

export function createRelay(host: () => HTMLElement | null) {
  const on = signal(false), holding = signal(false), error = signal(''), by = signal<string | null>(null);
  const ahead = signal(0), misses = signal(0), awake = signal<'yes' | 'no' | 'unsupported'>('no');
  const buffer = signal(200);
  let ws: WebSocket | null = null, runtime: Runtime | null = null, source: PiSource | null = null, sentRev = -1;
  let frameBytes = 0, fps = 40, retry = 0, lock: WakeLockSentinel | null = null, clock = slotClock(fps);

  const send = (m: FromPage) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  function onState(s: PiState) {
    by.value = s.relay?.by ?? null;
    if (!holding.peek() || !s.relay || !runtime) return;
    ahead.value = Math.round(s.relay.ahead * 1000 / fps);
    misses.value = s.relay.misses;
    clock.see(s.relay.index);
    const l = s.look;
    // A bake, or a source not here yet: nothing to render; the engine plays its own.
    if (!l || !source || source.rev !== l.rev || source.baked) { runtime.relay({ on: false }); return; }
    if (sentRev !== l.rev) {
      sentRev = l.rev;
      runtime.setLook(normaliseLayers(piLayers(source, libraryNow), rigNow), piExtra(source));
    }
    runtime.relay({ on: true, rev: l.rev, next: s.relay.next, frame: Math.round(l.t * fps), index: clock.at(),
      at: epoch(), fps, duration: l.duration, lead: Math.round(buffer.peek() * fps / 1000), set: relaySet(l) });
  }
  function onMessage(m: ToPage | { type: 'source', source: PiSource }) {
    if (m.type === 'hello') {
      if (m.ok) send({ type: 'relay-start' });
      else error.value = m.error ?? 'The lights ask for their PIN: say it on the lights\' page first.';
    } else if (m.type === 'relay') {
      holding.value = m.holding;
      if (m.holding) error.value = '';
      else {
        runtime?.relay({ on: false });
        if (m.error) error.value = m.error;
        // Taken back as soon as the link allows, while it is on (it ends on its own after a second with no frames).
        if (on.peek() && !retry) {
          retry = window.setTimeout(() => { retry = 0; if (on.peek()) send({ type: 'relay-start' }); }, RETRY_MS);
        }
      }
    } else if (m.type === 'source') source = m.source;
    else if (m.type === 'state') onState(m.state);
  }

  let rigNow: Awaited<ReturnType<typeof loadRig>> | null = null, libraryNow: { name: string, kind?: string,
    code: string }[] = [];
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
  const reopen = () => { retry = 0; if (on.peek()) { sentRev = -1; clock.reset(); open(); } };

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
    const [rig, lib] = await Promise.all([loadRig(), loadLibrary()]).catch((e) => {
      error.value = (e as Error).message;
      return [null, null] as const;
    });
    const el = host();
    if (!rig || !lib || !el || !on.peek()) { on.value = false; return; }
    rigNow = rig;
    libraryNow = lib;
    fps = rig.output?.fps || 40;
    clock = slotClock(fps);
    frameBytes = 8 + rig.count * 6;
    runtime = new Runtime({ container: el, time: () => 0, onFrame: () => {}, onCompiled: () => {},
      onFrameErrors: () => {}, onStatus: (state, detail) => {
        if (state === 'ready') sentRev = -1;      // a fresh sandbox: the look again at the next state
        if (state === 'dead') error.value = detail || 'The pattern engine stopped.';
      } });
    // A frame from the sandbox is untrusted: exactly a frame's size, or dropped.
    runtime.onRelayed = (bytes) => {
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== frameBytes || !holding.peek()) return;
      if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < BEHIND) ws.send(bytes);
    };
    runtime.start(rig, lib.filter((e) => (e.kind || 'source') === 'source').map(({ name, code }) => ({ name, code })));
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
    runtime?.destroy();
    runtime = null;
    source = null;
    sentRev = -1;
    holding.value = false;
    document.removeEventListener('visibilitychange', visible);
    void lock?.release().catch(() => {});
    lock = null;
    awake.value = 'no';
  }

  return { on, holding, error, by, ahead, misses, awake, buffer, start, stop,
    toggle() { if (on.peek()) stop(); else void start(); } };
}
export type Relay = ReturnType<typeof createRelay>;
