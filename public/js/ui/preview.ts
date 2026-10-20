// The Studio's preview: the 3D view (viewer.ts) and the sandbox runtime (runtime.ts), both imperative, driven by one
// clock that plays the look, the flash guard on every frame shown, and baked playback. One rAF loop advances the
// clock and pumps the sandbox (which computes at its own rate), only while playing or owed a frame, never while
// hidden or off screen; per frame it touches only the sinks (the timeline's playhead) and the time readout's signal,
// at most 8 times a second while playing.
import { computed, effect, signal } from '@preact/signals';

import type { LibraryEntry, Rig } from '../../../shared/schemas/rig.ts';
import { api, fetchJSON, statusOf } from '../api.ts';
import { LIGHT, lightOf } from '../core/light.ts';
import { FlashGuard } from '../flash-guard.ts';
import { openFrameStream } from '../frames-stream.ts';
import type { Venue } from '../playa/venue.ts';
import { Runtime } from '../runtime.ts';
import { isPhone, Viewer } from '../viewer.ts';
import { flash, signedOut, user } from './session.ts';
import { pref, toast } from './kit.tsx';
import type { Studio } from './studio-store.ts';

type Frames = Awaited<ReturnType<typeof openFrameStream>>;
const QUALITY = ['auto', 'full', 'lite', 'low'];
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');
const DIM = 0.15;
const seenFlashing = new Set<string>();     // looks whose flashing someone chose to see, this session
// "Dim fast-flashing previews": each person's choice on this browser, on unless they turned it off (even with reduced
// motion, which otherwise keeps a flashing look dimmed).
const dimKey = () => `studio.flashDim.${user.peek()?.id || 'anyone'}`;

export function createPreview(st: Studio) {
  const msg = signal<{ text: string; error?: boolean } | null>({ text: 'Loading the rig…' });
  const views = signal<string[]>([]), view = signal<string | null>(null);
  const mode = signal<'playa' | 'points'>('points'), tier = signal<string | undefined>(undefined);
  const quality = signal(QUALITY.includes(pref('studio.quality') || '') ? pref('studio.quality') as string : 'auto');
  const ghost = signal((pref('studio.ghost') ?? (isPhone() ? '0' : '1')) !== '0');   // phones start without
  const venue = signal(pref('studio.venue') !== '0');
  const dimmed = signal(false), stats = signal('');
  const flashing = signal(false), dimFlashes = signal(pref(dimKey()) !== '0');
  const bakedInfo = signal<{ seconds: number; bytes: number } | null>(null);
  const time = signal(0);
  const duration = computed(() => bakedInfo.value?.seconds ?? st.look.value.duration);
  const sinks: ((t: number, playing: boolean) => void)[] = [];    // an array: walking it allocates nothing
  const c = st.clock;
  let viewer: Viewer | null = null, runtime: Runtime | null = null, guard: FlashGuard | null = null;
  let baked: { frames: Frames; rgb: Float32Array; index: number } | null = null;
  let raf = 0, last = 0, statsAt = 0, clockAt = 0, onScreen = true, everReady = false, guarded = false;
  let heavyKey = '', bakedLoad = 0, pushTimer = 0, alive = true, frozen = false, io: IntersectionObserver | null = null;
  const disposers: (() => void)[] = [];

  // Every frame shown goes through show(): the view dims, with a banner, while a large area flashes over the
  // server's limit (flash-guard.ts) or the look's bake says it does, unless the check is off on this server or the
  // person turned dimming off. "Show it anyway" lasts the session; reduced motion keeps it dimmed.
  const flashKey = () => `studio.flash.${st.look.peek().id || 'new'}`;
  const remembered = () => { try { return sessionStorage.getItem(flashKey()) === '1'; } catch { return false; } };
  // Reads no signal (only peeks), so the effects below that call it follow only what they mean to.
  function setGuard(on: boolean) {
    const dim = on && dimFlashes.peek() && (REDUCE.matches || !(seenFlashing.has(flashKey()) || remembered()));
    flashing.value = guarded = on;
    dimmed.value = dim;
    viewer?.setOption('gain', dim ? DIM : 1);
  }
  function show(rgb: Float32Array, now: number) {
    const checked = flash.peek()?.check !== false;
    const on = !!guard?.observe(rgb, now) || (checked && st.server.peek()?.bake?.analysis?.flicker?.ok === false
      && !st.dirty.peek());
    if (on !== guarded) setGuard(on);
    viewer?.setColors(rgb);
  }

  const stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
  const kick = () => {
    if (!raf && alive && !frozen && st.ready.peek() && onScreen && !document.hidden) raf = requestAnimationFrame(loop);
  };
  function loop(now: number) {
    raf = 0;
    if (!alive) return;
    const dt = last && now - last < 250 ? (now - last) / 1000 : 0;
    last = now;
    const B = baked, playing = st.playing.peek(), d = duration.peek();
    if (playing) c.t = (c.t + dt * st.speed.peek()) % d;
    if (B) {   // baked frames: pick the frame for this time straight from the file
      const i = Math.min(B.frames.frameCount - 1, Math.floor(c.t * B.frames.fps));
      if (i !== B.index) { B.index = i; show(B.frames.frameAt(i, B.rgb), now); }
    } else runtime?.pump(c.t, playing);
    for (let i = 0; i < sinks.length; i++) sinks[i](c.t, playing);
    if (c.t !== time.peek() && (!playing || now - clockAt >= 120)) { clockAt = now; time.value = c.t; }
    if (now - statsAt > 1000 && runtime) {
      statsAt = now;
      const { fps, ms } = runtime.stats;
      stats.value = B ? `baked · ${B.frames.fps} fps`
        : runtime.ready && playing ? `${Math.round(fps)} fps · ${ms ? ms.toFixed(1) : '–'} ms` : '';
      const slow = runtime.heavy(), key = [...slow.keys()].join('|');
      if (key !== heavyKey) { heavyKey = key; st.heavy.value = slow; }
    }
    if (playing || (!B && runtime?.pending(c.t))) kick();
    else last = 0;
  }
  const onVisibility = () => (document.hidden ? stop() : kick());

  function push() {
    clearTimeout(pushTimer);
    pushTimer = 0;
    const { layers, extra } = st.sandboxLook.peek();
    runtime?.setLook(layers, extra);
    kick();
  }

  const p = {
    msg, views, view, mode, tier, quality, ghost, venue, dimmed, flashing, dimFlashes, stats, bakedInfo, time, duration,
    kick, push,
    get runtime() { return runtime; },
    get viewer() { return viewer; },
    /** Per frame: fn(t, playing). Returns its removal. */
    onFrame(fn: (t: number, playing: boolean) => void) {
      sinks.push(fn);
      return () => { sinks.splice(sinks.indexOf(fn), 1); };
    },
    seek(t: number) { c.t = t; time.value = t; kick(); },
    setPlaying(on: boolean) { st.playing.value = on; kick(); },
    /** A bug report's pause (SPEC "Bug reports"): the loop and the 3D view stop until thawed; nothing restarts them. */
    freeze(on: boolean) {
      frozen = on;
      if (on) time.value = c.t;     // the readout shows the moment exactly, not as of its last tick
      stop();
      viewer?.freeze(on);
      kick();
    },
    showAnyway() {
      seenFlashing.add(flashKey());
      try { sessionStorage.setItem(flashKey(), '1'); } catch { /* private mode: this page only */ }
      setGuard(guarded);
    },
    /** Dim fast-flashing previews (this person, this browser), or not. */
    setDimFlashes(on: boolean) {
      dimFlashes.value = on;
      pref(dimKey(), on ? '1' : '0');
      setGuard(guarded);
    },
    setGhost(on: boolean) {
      ghost.value = on;
      viewer?.setOption('ghost', on ? 0.14 : 0);
      pref('studio.ghost', on ? '1' : '0');
    },
    /** The venue's props (walls, walkways, ground) round the rig, or not. */
    setVenue(on: boolean) {
      venue.value = on;
      viewer?.showVenue(on);
      pref('studio.venue', on ? '1' : '0');
    },
    async setMode(m: string) {
      pref('studio.render', m);
      mode.value = (await viewer?.setMode(m)) || 'points';
      tier.value = viewer?.playa?.tier;
    },
    nextQuality() {
      quality.value = QUALITY[(QUALITY.indexOf(quality.value) + 1) % QUALITY.length];
      pref('studio.quality', quality.value);
      viewer?.setQuality(quality.value);
    },

    start(canvas: HTMLCanvasElement, sandboxHost: HTMLElement, onScreenEl: HTMLElement, rig: Rig,
      library: LibraryEntry[]) {
      const v = viewer = new Viewer(canvas, { views: rig.views || {}, defaultView: 'fit',
        onError: (text: string) => { msg.value = { text, error: true }; } });
      v.setRig(rig);
      // The guard takes the server's limits; with the check off there (local use), there is none. It and the view
      // take the light settings (the defaults until they come).
      if (!flash.peek()) api.me().then((m) => { flash.value = m.flash ?? null; }, () => {});
      const light = signal(LIGHT);
      api.light().then((l) => { light.value = lightOf(l); v.setLight(light.value); }, () => {});
      disposers.push(effect(() => {
        const f = flash.value;
        guard = f?.check === false ? null : new FlashGuard(rig, f, light.value);
        setGuard(false);
      }), effect(() => {
        void user.value;
        dimFlashes.value = pref(dimKey()) !== '0';
        setGuard(guarded);
      }));
      views.value = ['fit', ...Object.keys(rig.views || {})];
      v.onViewChange = (name) => { view.value = name; };
      view.value = v.currentView ?? null;
      v.onRender = (m, t) => { mode.value = m; tier.value = t; };
      p.setGhost(ghost.value);
      p.setVenue(venue.value);
      fetchJSON<Venue>(new URL('../../data/venue.json', import.meta.url).href)
        .then((d) => { if (alive) void v.setVenue(d); }, () => {});     // none: the rig alone
      v.setQuality(quality.value);
      p.setMode(pref('studio.render') === 'points' ? 'points' : 'playa');
      runtime = new Runtime({
        container: sandboxHost,
        onFrame: (rgb: Float32Array) => show(rgb, performance.now()),
        time: () => (last ? (c.t + ((performance.now() - last) / 1000) * st.speed.peek()) % duration.peek() : c.t),
        onCompiled: (layers) => { if (st.status.compiled(layers)) st.fallbackRev.value++; kick(); },
        onFrameErrors: (errors) => st.status.frameErrors(errors),
        onStatus: (state, detail) => {
          if (state === 'loading' && !everReady) msg.value = { text: 'Starting the pattern engine…' };
          else if (state === 'ready') { everReady = true; msg.value = null; kick(); }
          else if (state === 'dead') msg.value = { text: detail || 'The pattern engine stopped.', error: true };
          else if (state === 'warning' && detail) toast(detail, { kind: 'warn' });
        },
      });
      runtime.start(rig, library.filter((e) => (e.kind || 'source') === 'source')
        .map(({ name, code }) => ({ name, code })));
      // What the sandbox runs follows the look; while code is being typed, it waits for the typing to settle.
      disposers.push(effect(() => {
        void st.sandboxLook.value;
        const wait = c.typingUntil - performance.now();
        clearTimeout(pushTimer);
        if (wait > 0) pushTimer = window.setTimeout(push, wait); else push();
      }), effect(() => {         // the server's copy lost its frames (a new bake, an edit): back to live
        if (baked && !st.server.value?.bake?.frames) p.playBaked(false);
      }), effect(() => {
        // Picking a layer's groups: its groups and the ones pointed at or pinned as they are, the rest extra dim.
        const hover = st.hoverGroup.value, pinned = st.pinnedGroup.value, key = st.focusKey.value;
        const id = hover || pinned, index = st.data.index;
        if (key === null || !index) return v.setHighlight(id ? index?.masks.get(id) || null : null);
        const [groups, tags] = JSON.parse(key) as [string[] | null, string[] | null];
        v.setHighlight(index.layerMask(groups ?? undefined, tags ?? undefined, hover, pinned), true);
      }));
      st.flush = () => { c.typingUntil = 0; if (pushTimer) push(); };
      st.onEdit = () => {
        if (!baked) return;
        p.playBaked(false);
        toast('Back to the live preview: the baked frames show the look as it was baked, not your edits.',
          { timeout: 5000 });
      };
      document.addEventListener('visibilitychange', onVisibility);
      io = new IntersectionObserver((entries) => {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (onScreen) kick(); else stop();
      });
      io.observe(onScreenEl);
      kick();
    },

    /** Baked playback: the server's frames, no pattern code. */
    async playBaked(on: boolean) {
      const token = ++bakedLoad, id = st.look.peek().id, rig = st.data.rig;
      if (!on) {
        if (!baked) return;
        baked = null;
        bakedInfo.value = null;
        st.baked.value = false;
        c.t = 0;
        runtime?.pump(0, true);      // a fresh frame from the live look
        kick();
        return;
      }
      if (!id || !rig) return;
      msg.value = { text: 'Loading the baked frames…' };
      try {
        let frames: Frames | null = null;
        // A chunk that was still on its way when its frame came up has arrived: redraw it.
        const onChunk = () => { if (frames && baked?.frames === frames) { baked.index = -1; kick(); } };
        frames = await openFrameStream(id, rig, { onChunk });
        if (!alive || token !== bakedLoad) return;
        baked = { frames, rgb: new Float32Array(rig.count * 3), index: -1 };
        c.t = 0;
        st.playing.value = true;
        msg.value = null;
        bakedInfo.value = { seconds: frames.seconds, bytes: frames.bytes };
        st.baked.value = true;
        kick();
      } catch (err) {
        if (!alive || token !== bakedLoad) return;
        msg.value = null;
        if (statusOf(err) === 401) return signedOut();
        toast((err as Error).message, { kind: 'error', timeout: 7000 });
      }
    },

    destroy() {
      alive = false;
      stop();
      clearTimeout(pushTimer);
      for (const d of disposers) d();
      document.removeEventListener('visibilitychange', onVisibility);
      bakedLoad++;
      baked = null;
      io?.disconnect();
      runtime?.destroy();
      viewer?.destroy();
    },
  };
  return p;
}
export type Preview = ReturnType<typeof createPreview>;
