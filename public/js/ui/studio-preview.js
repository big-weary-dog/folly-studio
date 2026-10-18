// The Studio's preview: the 3D view, the transport, the sandbox runtime, and the clock that plays the look.
import { FlashGuard } from '../flash-guard.js';
import { openFrameStream } from '../frames-stream.js';
import { Runtime } from '../runtime.js';
import { Viewer } from '../viewer.js';
import { mb } from './bake.js';
import { h, nextId, pref, rose, toast } from './dom.js';
import { viewModes } from './view-mode.js';

const NARROW = matchMedia('(max-width: 899px)');
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');
const DIM = 0.15;
const shown = new Set();     // looks whose flashing someone chose to see, this session
const time = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const label = (n) => n.charAt(0).toUpperCase() + n.slice(1);

export function createPreview({ S, ui, alive, timeline, onCompiled, onFrameErrors, onBaked, onHeavy, signedOut }) {
  const p = { runtime: null, viewer: null };
  let raf = 0, last = 0, statsAt = 0, onScreen = true, io = null, bakedLoad = 0, everReady = false, heavy = '';
  const flash = flashGuard(S, ui);
  const transport = createTransport(ui.paneViewer, {
    onPlay: () => p.setPlaying(!S.playing),
    onSeek: (t) => { S.t = t; p.kick(); },
    onSpeed: (s) => { S.speed = s; },
  });

  p.showMsg = (text, error = false) => {
    ui.viewerMsg.replaceChildren(error ? '' : rose({ detail: 'full', className: 'rose-loader' }), text);
    ui.viewerMsg.classList.toggle('error', error);
    ui.viewerMsg.hidden = false;
  };
  p.hideMsg = () => { ui.viewerMsg.hidden = true; };

  function setupViewer(rig) {
    const views = rig.views || {};
    const viewer = p.viewer = new Viewer(ui.canvas, { views, defaultView: 'fit', onError: (m) => p.showMsg(m, true) });
    viewer.setRig(rig);
    flash.start(rig, viewer);
    // Views frame what the buttons over the view leave clear; phones' toasts sit just above the transport.
    p.ro = new ResizeObserver(() => {
      const bar = [ui.viewBar, ui.viewCompact].find((el) => el.offsetHeight);
      viewer.setOption('insetTop', bar ? bar.offsetTop + bar.offsetHeight + 4 : 0);
      const top = NARROW.matches ? transport.el.getBoundingClientRect().top : 0;
      const root = document.documentElement.style;
      if (top > 0) root.setProperty('--toasts-bottom', `${Math.round(innerHeight - top + 8)}px`);
      else root.removeProperty('--toasts-bottom');
    });
    for (const el of [ui.viewBar, ui.viewCompact, ui.paneViewer]) p.ro.observe(el);
    for (const name of ['fit', ...Object.keys(views)]) {
      const title = name === 'fit' ? 'Frame the whole installation (double-click the view does this too)'
        : `The “${name}” view`;
      ui.viewBar.append(h('button', { type: 'button', class: 'view-btn', dataset: { view: name },
        'aria-pressed': 'false', title, text: label(name), onClick: () => viewer.setView(name) }));
      ui.viewSelect.append(h('option', { value: name, text: label(name) }));
    }
    ui.viewSelect.append(h('option', { value: '', text: 'Free camera', disabled: true }));
    ui.viewSelect.addEventListener('change', () => { if (ui.viewSelect.value) viewer.setView(ui.viewSelect.value); });
    // Ghost (unlit LEDs shown faintly): one button in the bar and one in the compact view.
    const ghosts = [ui.viewBar, ui.viewCompact].map((host) => host.appendChild(h('button', { type: 'button',
      class: 'view-btn ghost-btn', text: 'Ghost', title: 'Show unlit LEDs faintly',
      onClick: () => setGhost(ghosts[0].getAttribute('aria-pressed') !== 'true') })));
    const setGhost = (on) => {
      for (const b of ghosts) b.setAttribute('aria-pressed', String(on));
      viewer.setOption('ghost', on ? 0.14 : 0);
      pref('studio.ghost', on ? '1' : '0');
    };
    setGhost(pref('studio.ghost') !== '0');
    viewModes(viewer, [ui.viewBar, ui.viewCompact]);
  }

  function setupRuntime(rig, library) {
    p.runtime = new Runtime({
      container: ui.sandboxHost,
      onFrame: (rgb) => flash.show(rgb, performance.now()),
      time: () => (last ? (S.t + ((performance.now() - last) / 1000) * S.speed) % S.look.duration : S.t),
      onCompiled: (layers) => { onCompiled(layers); p.kick(); },
      onFrameErrors,
      onStatus: (state, detail) => {
        if (state === 'loading' && !everReady) p.showMsg('Starting the pattern engine…');
        else if (state === 'ready') { everReady = true; p.hideMsg(); p.kick(); }
        else if (state === 'dead') p.showMsg(detail || 'The pattern engine stopped.', true);
        else if (state === 'warning' && detail) toast(detail, { kind: 'warn' });
      },
    });
    p.runtime.start(rig, library);
  }

  p.start = (rig, library = []) => {
    setupViewer(rig);
    setupRuntime(rig, library.map(({ name, code }) => ({ name, code })));
    document.addEventListener('visibilitychange', onVisibility);
    io = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      if (onScreen) p.kick(); else stop();
    });
    io.observe(ui.viewerWrap);
    p.viewer.onViewChange = syncViewButtons;
    syncViewButtons(p.viewer.currentView);
  };

  function syncViewButtons(name) {
    for (const b of ui.viewBar.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', b.dataset.view === name);
    ui.viewSelect.value = name || '';
  }

  // One rAF loop advances the clock and pumps the sandbox (which computes at its own rate), only while playing or
  // owed a frame, and never while hidden or off screen. The viewer draws on its own, when something changed.
  const stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
  const onVisibility = () => (document.hidden ? stop() : p.kick());
  p.kick = () => {
    if (!raf && alive() && S.ready && onScreen && !document.hidden) raf = requestAnimationFrame(loop);
  };
  p.setPlaying = (on) => { S.playing = on; p.kick(); };

  function loop(now) {
    raf = 0;
    if (!alive()) return;
    const dt = last && now - last < 250 ? (now - last) / 1000 : 0;
    last = now;
    const B = S.baked, { runtime } = p;
    const duration = B ? B.frames.seconds : S.look.duration;
    if (S.playing) S.t = (S.t + dt * S.speed) % duration;
    if (B) {
      // Baked frames: pick the frame for this time straight from the file.
      const i = Math.min(B.frames.frameCount - 1, Math.floor(S.t * B.frames.fps));
      if (i !== B.index) { B.index = i; flash.show(B.frames.frameAt(i, B.rgb), now); }
    } else runtime?.pump(S.t, S.playing);
    transport.set(S.playing, S.t, duration, now);
    timeline.setTime(S.t, S.playing);
    if (now - statsAt > 1000 && runtime) {
      statsAt = now;
      const { fps, ms } = runtime.stats;
      const live = runtime.ready && S.playing ? `${Math.round(fps)} fps · ${ms ? ms.toFixed(1) : '–'} ms` : '';
      transport.setStats(B ? `baked · ${B.frames.fps} fps` : live);
      const slow = runtime.heavy(), key = [...slow.keys()].join('|');
      if (key !== heavy) { heavy = key; onHeavy(slow); }
    }
    if (S.playing || (!B && runtime?.pending(S.t))) p.kick();
    else last = 0;
  }

  // Baked playback: the server's frames, no pattern code.
  p.playBaked = async (on) => {
    const token = ++bakedLoad;
    const show = (yes) => { ui.bakedBadge.hidden = !yes; ui.studio.classList.toggle('is-baked', yes); onBaked(yes); };
    if (!on) {
      if (!S.baked) return;
      S.baked = null;
      show(false);
      S.t = 0;
      p.runtime?.pump(S.t, true);       // a fresh frame from the live look
      return p.kick();
    }
    if (!S.look.id || !S.rig) return;
    p.showMsg('Loading the baked frames…');
    try {
      // A chunk that was still on its way when its frame came up has arrived: redraw it.
      let frames = null;
      const onChunk = () => { if (frames && S.baked?.frames === frames) { S.baked.index = -1; p.kick(); } };
      frames = await openFrameStream(S.look.id, S.rig, { onChunk });
      if (!alive() || token !== bakedLoad) return;
      Object.assign(S, { baked: { frames, rgb: new Float32Array(S.rig.count * 3), index: -1 }, t: 0,
        playing: true });
      p.hideMsg();
      ui.bakedText.replaceChildren(`Baked frames · ${frames.seconds.toFixed(frames.seconds % 1 ? 1 : 0)} s`,
        h('span', { class: 'baked-extra', text: ` · ${mb(frames.bytes)} · no code running` }));
      show(true);
      p.kick();
    } catch (err) {
      if (!alive() || token !== bakedLoad) return;
      p.hideMsg();
      if (err.status === 401) return signedOut();
      toast(err.message, { kind: 'error', timeout: 7000 });
    }
  };
  ui.bakedLive.addEventListener('click', () => p.playBaked(false));

  p.destroy = () => {
    stop();
    p.ro?.disconnect();
    document.documentElement.style.removeProperty('--toasts-bottom');
    document.removeEventListener('visibilitychange', onVisibility);
    bakedLoad++;
    S.baked = null;
    io?.disconnect();
    p.runtime?.destroy();
    p.viewer?.destroy();
  };
  return p;
}

/** Play/pause, restart, the time, scrub and speed: { el, set(playing, t, duration, now), setStats(text) }. */
function createTransport(container, { onPlay, onSeek, onSpeed }) {
  const ids = [nextId('scrub'), nextId('speed')];
  const play = h('button', { type: 'button', class: 'tp-play', onClick: onPlay });
  const clock = h('span', { class: 'tp-time', 'aria-label': 'Time' });
  const scrub = h('input', { type: 'range', id: ids[0], class: 'tp-scrub', min: 0, max: 30, step: 0.01, value: 0,
    onInput: () => onSeek(+scrub.value) });
  const speed = h('select', { id: ids[1], class: 'tp-speed', onChange: () => onSpeed(+speed.value) },
    [0.25, 0.5, 1, 2, 4].map((s) => h('option', { value: String(s), text: `${s}×` })));
  speed.value = '1';
  const stats = h('span', { class: 'tp-stats', 'aria-hidden': 'true' });
  const el = h('div', { class: 'transport', role: 'group', 'aria-label': 'Transport' },
    h('button', { type: 'button', class: 'tp-btn tp-restart', 'aria-label': 'Back to start', title: 'Back to start',
      onClick: () => onSeek(0) }), play, clock, h('label', { for: ids[0], class: 'sr-only', text: 'Scrub time' }),
    scrub, h('label', { for: ids[1], class: 'sr-only', text: 'Speed' }), speed, stats);
  container.append(el);
  let scrubbing = false;
  for (const [type, on] of [['pointerdown', true], ['pointerup', false], ['blur', false]]) {
    scrub.addEventListener(type, () => { scrubbing = on; });
  }
  const L = { playing: null, t: -1, duration: -1, at: 0 };
  return {
    el,
    /** Every frame: touches the DOM only when something visible changes, the clock ≤ 8 times a second. */
    set(playing, t, duration, now) {
      let force = playing !== L.playing || duration !== L.duration;
      if (playing !== L.playing) {
        play.classList.toggle('playing', playing);
        play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        play.title = playing ? 'Pause (Space)' : 'Play (Space)';
      }
      if (duration !== L.duration) scrub.max = String(duration);
      Object.assign(L, { playing, duration });
      if (t === L.t || (!force && playing && now - L.at < 120)) return;
      Object.assign(L, { t, at: now });
      clock.textContent = `${time(t)} / ${time(duration)}`;
      if (!scrubbing) scrub.value = String(t);
    },
    setStats(text) { if (stats.textContent !== text) stats.textContent = text; },
  };
}

// Every frame shown goes through show(): the view dims, with a banner, while a large area flashes over 3 times a
// second (flash-guard.js) or the look's bake says it does. "Show it anyway" lasts the session; reduced motion dims.
function flashGuard(S, ui) {
  let guard = null, viewer = null, guarded = false;
  const key = () => `studio.flash.${S.look.id || 'new'}`;
  const remembered = () => { try { return sessionStorage.getItem(key()) === '1'; } catch { return false; } };
  const anyway = h('button', { type: 'button', class: 'btn small', text: 'Show it anyway', onClick: () => {
    shown.add(key());
    try { sessionStorage.setItem(key(), '1'); } catch { /* private mode: this page only */ }
    set(guarded);
  } });
  const text = h('span', { class: 'flash-text' });
  ui.viewerWrap.append(h('div', { class: 'viewer-msg flash-banner', role: 'status', hidden: true }, text, anyway));
  function set(on) {
    guarded = on;
    const dim = on && (REDUCE.matches || !(shown.has(key()) || remembered()));
    viewer?.setOption('gain', dim ? DIM : 1);
    text.parentNode.hidden = !dim;
    anyway.hidden = REDUCE.matches;
    text.textContent = REDUCE.matches ? 'This look flashes quickly, so it stays dimmed: your device asks for '
      + 'reduced motion.' : 'This look flashes quickly. Show it anyway?';
  }
  return {
    start(rig, v) { guard = new FlashGuard(rig); viewer = v; },
    /** Shows a frame (rgb, as the viewer takes it) seen at `now` ms. */
    show(rgb, now) {
      const flashing = guard.observe(rgb, now) || (S.server?.bake?.analysis?.flicker?.ok === false && !S.dirty);
      if (flashing !== guarded) set(flashing);
      viewer.setColors(rgb);
    },
  };
}
