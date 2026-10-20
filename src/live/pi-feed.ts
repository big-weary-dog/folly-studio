// /pi's engine as the live stage follows it (SPEC-live "Following /pi"): one socket from this server to the dry run at
// PI_PREVIEW_URL (on this machine), saying hello as its page does, turning what it sends into the stage's PiNow and
// PiSource. It reconnects after 1 s, doubling to 10 s. It connects nowhere else, and never to the Pi itself.
import WebSocket from 'ws';

import type { PiNow, PiSource } from '../../shared/schemas/live.ts';

const FIRST_WAIT_MS = 1000, MAX_WAIT_MS = 10_000;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
type Look = { rev: number, t: number, bpm: number, beat0: number, offset: number,
  controls: { name: string, value: number, kind: string }[] };

/** The engine's state message → PiNow (null: nothing plays), or undefined if it is not one. */
export function piNowOf(state: { look?: Look | null, gain?: number } | null): PiNow | null | undefined {
  if (!state || !num(state.gain)) return undefined;
  const l = state.look;
  if (!l) return null;
  if (![l.rev, l.t, l.bpm, l.beat0, l.offset].every(num) || !Array.isArray(l.controls)) return undefined;
  const values = Object.fromEntries(l.controls.filter((c) => c.kind !== 'bpm' && num(c.value))
    .map((c) => [String(c.name), c.value]));
  return { rev: l.rev, t: l.t, bpm: l.bpm, beat0: l.beat0, offset: l.offset, values, gain: state.gain };
}

export function piFeed({ target, base = '/pi', onNow, onSource }: { target: URL, base?: string,
  onNow: (now: PiNow | null) => void, onSource: (source: PiSource) => void }) {
  const url = `${target.protocol === 'https:' ? 'wss:' : 'ws:'}//${target.host}${base}/ws`;
  let ws: WebSocket | null = null, wait = FIRST_WAIT_MS, timer: NodeJS.Timeout | null = null, alive = true;
  function connect() {
    timer = null;
    // The engine takes its own page's origin only: this one, as it sees the request.
    const s = ws = new WebSocket(url, { origin: target.origin, maxPayload: 1 << 20, handshakeTimeout: 5000 });
    s.on('open', () => { wait = FIRST_WAIT_MS; s.send(JSON.stringify({ type: 'hello' })); });
    s.on('message', (d) => {
      let m;
      try { m = JSON.parse(String(d)); } catch { return; }
      if (m?.type === 'source' && m.source && num(m.source.rev) && Array.isArray(m.source.layers)) onSource(m.source);
      else if (m?.type === 'state') {
        const now = piNowOf(m.state);
        if (now !== undefined) onNow(now);
      }
    });
    s.on('error', () => s.terminate());
    s.on('close', () => {
      if (ws !== s) return;
      ws = null;
      onNow(null);
      if (alive) timer = setTimeout(connect, wait);
      wait = Math.min(MAX_WAIT_MS, wait * 2);
    });
  }
  connect();
  return {
    close() {
      alive = false;
      if (timer) clearTimeout(timer);
      ws?.terminate();
    },
  };
}
