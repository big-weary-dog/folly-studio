// The live stage on a viewer: the 3D view and the pattern sandbox (as the Studio's preview), driven by the server's
// clock. Each display frame asks for show time t on the rig's frame grid, so every viewer computes the same frames;
// the look goes to the sandbox again only when the state changed (its code stays compiled, its clock fresh). Layer
// levels and blackout change at an update's `at`. On a touch screen the Playa view starts on Low.
import { signal } from '@preact/signals';

import type { LiveUpdate } from '../../../../shared/schemas/live.ts';
import { Runtime } from '../../runtime.ts';
import { Viewer } from '../../viewer.ts';
import { pref, toast } from '../kit.tsx';
import { loadLibrary, loadRig, normaliseLayers, type Layer } from '../model.ts';
import { roll, showTime, stageAutomation } from './lanes.ts';
import type { LiveSocket } from './socket.ts';

type Pending = Pick<LiveUpdate, 'at' | 'layers' | 'blackout'>;
type Probe = { frames: Map<number, number> };
const PROBE_KEEP = 400, PROBE_STEP = 10;
const IDLE = 'Nothing is playing yet.';

export function createStage(sock: LiveSocket) {
  const msg = signal<{ text: string, error?: boolean } | null>({ text: 'Loading the rig…' });
  const stats = signal(''), blackout = signal(false), t = signal(0);
  let viewer: Viewer | null = null, runtime: Runtime | null = null, raf = 0, alive = true, dirty = true;
  let fps = 40, statsAt = 0, layersFor: { id: string, layers: Layer[] } | null = null;
  const pending: Pending[] = [];
  // ?probe=1: each frame's sum by its index on the grid, for the browser checks (test/e2e/live.spec.ts). Its time
  // steps every PROBE_STEP grid frames, so viewers at any compute rate render the same frames to compare.
  const probe: Probe | null = new URLSearchParams(location.search).get('probe') === '1' ? { frames: new Map() } : null;
  if (probe) (window as unknown as { __liveProbe: Probe }).__liveProbe = probe;

  const unlisten = sock.listen((why) => {
    dirty = true;
    kick();
    if (why === 'state') {
      pending.length = 0;
      blackout.value = !!sock.live?.blackout;
    } else if (why.layers || why.blackout !== undefined) pending.push(why);
  });

  /** Show time now, on the frame grid. */
  const gridT = () => {
    const live = sock.live;
    if (!live?.look) return 0;
    const { t: now } = showTime(live, sock.now());
    const step = probe ? PROBE_STEP : 1;
    return Math.floor(now * fps / step) * step / fps;
  };

  function send() {
    const live = sock.live;
    if (!live?.look || !runtime) return;
    const look = live.look;
    if (layersFor?.id !== `${look.id}@${live.startedAt}`) {
      layersFor = { id: `${look.id}@${live.startedAt}`, layers: normaliseLayers(look.layers, viewer?.rig ?? null) };
    }
    const layers = layersFor.layers.map((l) => {
      const set = live.layers[l.id];
      return set ? { ...l, level: set.muted ? 0 : l.level * (set.level ?? 1) } : l;
    });
    runtime.setLook(layers, { globals: look.globals, automation: stageAutomation(live), bpm: look.bpm,
      clock: 'fresh' });
  }

  function loop() {
    raf = 0;
    if (!alive) return;
    const live = sock.live, now = sock.now();
    while (pending.length && pending[0].at <= now) {
      const p = pending.shift()!;
      if (p.layers && live) live.layers = p.layers;
      if (p.blackout !== undefined) blackout.value = p.blackout;
      dirty = true;
    }
    viewer?.setOption('gain', blackout.peek() ? 0 : 1);
    if (live?.look) {
      if (roll(live, showTime(live, now).loop)) dirty = true;
      if (dirty) { dirty = false; send(); }
      const at = gridT();
      t.value = at;
      runtime?.pump(at, true);
      if (msg.peek()?.text === IDLE) msg.value = null;
    } else if (runtime?.ready && !msg.peek()) msg.value = { text: IDLE };
    if (now - statsAt > 1000 && runtime) {
      statsAt = now;
      const c = sock.clock.peek();
      stats.value = `${Math.round(runtime.stats.fps)} fps · clock ±${c && Number.isFinite(c.rtt)
        ? Math.round(c.rtt / 2) : '?'} ms`;
    }
    if (live?.look || pending.length) kick();     // nothing on stage: asleep until the socket says otherwise
  }
  const kick = () => { if (!raf && alive && runtime) raf = requestAnimationFrame(loop); };

  return {
    msg, stats, blackout, t,
    get viewer() { return viewer; },
    async start(canvas: HTMLCanvasElement, sandboxHost: HTMLElement) {
      const [rig, library] = await Promise.all([loadRig(), loadLibrary()]).catch((err) => {
        msg.value = { text: (err as Error).message, error: true };
        return [null, null] as const;
      });
      if (!rig || !library || !alive) return;
      fps = rig.output?.fps || 40;
      const v = viewer = new Viewer(canvas, { views: rig.views || {}, defaultView: 'fit',
        onError: (text) => { msg.value = { text, error: true }; } });
      v.setRig(rig);
      const quality = pref('studio.quality');
      v.setQuality(quality && quality !== 'auto' ? quality : matchMedia('(pointer: coarse)').matches ? 'low' : 'auto');
      await v.setMode(pref('studio.render') === 'points' ? 'points' : 'playa');
      runtime = new Runtime({
        container: sandboxHost, time: gridT,
        onFrame: (rgb, at) => {
          viewer?.setColors(rgb);
          if (!probe) return;
          let sum = 0;
          for (let i = 0; i < rgb.length; i++) sum += rgb[i] * ((i % 97) + 1);
          probe.frames.set(Math.round(at * fps), sum);
          if (probe.frames.size > PROBE_KEEP) probe.frames.delete(probe.frames.keys().next().value!);
        },
        onCompiled: () => {}, onFrameErrors: () => {},
        onStatus: (state, detail) => {
          kick();
          if (state === 'loading') msg.value = { text: 'Starting the pattern engine…' };
          else if (state === 'ready') msg.value = null;
          else if (state === 'dead') msg.value = { text: detail || 'The pattern engine stopped.', error: true };
          else if (detail) toast(detail, { kind: 'warn' });
        },
      });
      runtime.start(rig, library.filter((e) => (e.kind || 'source') === 'source').map(({ name, code }) => ({ name,
        code })));
      kick();
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      unlisten();
      runtime?.destroy();
      viewer?.destroy();
    },
  };
}
export type Stage = ReturnType<typeof createStage>;
