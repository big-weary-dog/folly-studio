// The Studio's preview: the 3D view and its camera buttons, the sandbox runtime, and the one clock
// that plays the look (or its baked frames) and pumps frames to the sandbox.
import { FlashGuard } from '../flash-guard.js';
import { Runtime } from '../runtime.js';
import { Viewer } from '../viewer.js';
import { openFrameStream } from '../frames-stream.js';
import { mb } from './bake.js';
import { h, pref, toast } from './dom.js';
import { rose } from './rose.js';
import { Transport } from './transport.js';

// createPreview({ S, ui, alive(), timeline, onCompiled(layers), onFrameErrors(errors), onBaked(on), signedOut() })
//   → { start(cathedral), kick(), setPlaying(on), playBaked(on), showMsg(text, error?), hideMsg(), runtime, viewer,
//   destroy() }
export function createPreview({ S, ui, alive, timeline, onCompiled, onFrameErrors, onBaked, signedOut }) {
  const p = { runtime: null, viewer: null };
  let raf = 0, last = 0, statsAt = 0, onScreen = true, io = null, bakedLoad = 0, everReady = false;
  const flash = flashGuard(S, ui);
  const transport = new Transport(ui.paneViewer, {
    onPlay: () => p.setPlaying(!S.playing),
    onRestart: () => { S.t = 0; p.kick(); },
    onSeek: (t) => { S.t = t; p.kick(); },
    onSpeed: (s) => { S.speed = s; },
  });

  p.showMsg = (text, error = false) => {
    ui.viewerMsg.replaceChildren(error ? '' : rose({ detail: 'full', className: 'rose-loader' }), text);
    ui.viewerMsg.classList.toggle('error', error);
    ui.viewerMsg.hidden = false;
  };
  p.hideMsg = () => { ui.viewerMsg.hidden = true; };

  function setupViewer(cathedral) {
    const views = cathedral.views || {};
    const onError = (msg) => p.showMsg(msg, true);
    const viewer = p.viewer = new Viewer(ui.canvas, { views, defaultView: 'fit', onError });
    viewer.setCathedral(cathedral);
    flash.start(cathedral, viewer);
    // Views frame what the buttons over the top of the view leave clear; phones' toasts sit just above
    // the transport, clear of the panels below it.
    p.ro = new ResizeObserver(() => {
      const bar = [ui.viewBar, ui.viewCompact].find((el) => el.offsetHeight);
      viewer.setOption('insetTop', bar ? bar.offsetTop + bar.offsetHeight + 4 : 0);
      const top = NARROW.matches ? transport.el.getBoundingClientRect().top : 0;
      const root = document.documentElement.style;
      if (top > 0) root.setProperty('--toasts-bottom', `${Math.round(innerHeight - top + 8)}px`);
      else root.removeProperty('--toasts-bottom');
    });
    for (const el of [ui.viewBar, ui.viewCompact, ui.paneViewer]) p.ro.observe(el);
    const label = (n) => n.charAt(0).toUpperCase() + n.slice(1);
    for (const name of ['fit', ...Object.keys(views)]) {
      const title = name === 'fit' ? 'Frame the whole cathedral (double-click the view does this too)'
        : `The “${name}” view from views.json`;
      ui.viewBar.append(h('button', { type: 'button', class: 'view-btn', dataset: { view: name },
        'aria-pressed': 'false', title, text: label(name), onClick: () => viewer.setView(name) }));
      ui.viewSelect.append(h('option', { value: name, text: label(name) }));
    }
    ui.viewSelect.append(h('option', { value: '', text: 'Free camera', disabled: true }));
    ui.viewSelect.addEventListener('change', () => { if (ui.viewSelect.value) viewer.setView(ui.viewSelect.value); });
    // Ghost (unlit LEDs shown faintly): one button in the bar and one in the compact view.
    const ghost = pref('studio.ghost') !== '0';
    const ghosts = [ui.viewBar, ui.viewCompact].map((host) => host.appendChild(h('button', { type: 'button',
      class: 'view-btn ghost-btn', 'aria-pressed': String(ghost), text: 'Ghost', title: 'Show unlit LEDs faintly',
      onClick: () => setGhost(ghosts[0].getAttribute('aria-pressed') !== 'true') })));
    const setGhost = (on) => {
      for (const b of ghosts) b.setAttribute('aria-pressed', String(on));
      viewer.setOption('ghost', on ? 0.14 : 0);
      pref('studio.ghost', on ? '1' : '0');
    };
    if (!ghost) viewer.setOption('ghost', 0);
  }

  function setupRuntime(cathedral) {
    p.runtime = new Runtime({
      container: ui.sandboxHost,
      onFrame: (rgb) => flash.show(rgb, performance.now()),
      onCompiled: (layers) => { onCompiled(layers); p.kick(); },
      onFrameErrors,
      onStatus: (state, detail) => {
        if (state === 'loading' && !everReady) p.showMsg('Starting the pattern engine…');
        else if (state === 'ready') { everReady = true; p.hideMsg(); p.kick(); }
        else if (state === 'dead') p.showMsg(detail || 'The pattern engine stopped.', true);
        else if (state === 'warning' && detail) toast(detail, { kind: 'warn' });
      },
    });
    p.runtime.start(cathedral);
  }

  p.start = (cathedral) => {
    setupViewer(cathedral);
    setupRuntime(cathedral);
    document.addEventListener('visibilitychange', onVisibility);
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (onScreen) p.kick(); else stop();
      });
      io.observe(ui.viewerWrap);
    }
    p.viewer.onViewChange = syncViewButtons;
    syncViewButtons(p.viewer.currentView);
  };

  function syncViewButtons(name) {
    for (const b of ui.viewBar.querySelectorAll('[data-view]')) {
      b.setAttribute('aria-pressed', String(b.dataset.view === name));
    }
    ui.viewSelect.value = name || '';
  }

  // One rAF loop advances the clock and pumps frames to the sandbox. It runs only while playing
  // or while the sandbox still owes a frame, and never while the tab is hidden or the 3D view is
  // off screen. (The viewer draws on its own, only when something changed.)
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
    const B = S.baked;
    const duration = B ? B.frames.seconds : S.look.duration;
    if (S.playing) {
      S.t += dt * S.speed;
      if (S.t >= duration) S.t %= duration;
    }
    const { runtime, viewer } = p;
    if (B) {
      // Baked frames: pick the frame for this time straight from the file.
      const i = Math.min(B.frames.frameCount - 1, Math.floor(S.t * B.frames.fps));
      if (i !== B.index && viewer) { B.index = i; flash.show(B.frames.frameAt(i, B.rgb), now); }
    } else if (runtime) runtime.pump(S.t, S.playing);
    transport.set(S.playing, S.t, duration, now);
    timeline.setTime(S.t, S.playing);
    if (now - statsAt > 1000 && runtime) {
      statsAt = now;
      const st = runtime.stats;
      const ms = st.ms ? st.ms.toFixed(1) : '–';
      const live = runtime.ready && S.playing ? `${Math.round(st.fps)} fps · ${ms} ms` : '';
      transport.setStats(B ? `baked · ${B.frames.fps} fps` : live);
    }
    if (S.playing || (!B && runtime && runtime.pending(S.t))) p.kick();
    else last = 0;
  }

  // Baked playback: the server's frames, no pattern code.
  p.playBaked = async (on) => {
    const token = ++bakedLoad;
    const shown = (yes) => { ui.bakedBadge.hidden = !yes; ui.studio.classList.toggle('is-baked', yes); onBaked(yes); };
    if (!on) {
      if (!S.baked) return;
      S.baked = null;
      shown(false);
      S.t = 0;
      p.runtime?.pump(S.t, true);       // a fresh frame from the live look
      return p.kick();
    }
    if (!S.look.id || !S.cathedral) return;
    p.showMsg('Loading the baked frames…');
    try {
      // A chunk that was still on its way when its frame came up has arrived: redraw it.
      let frames = null;
      const onChunk = () => { if (frames && S.baked?.frames === frames) { S.baked.index = -1; p.kick(); } };
      frames = await openFrameStream(S.look.id, S.cathedral, { onChunk });
      if (!alive() || token !== bakedLoad) return;
      const rgb = new Float32Array(S.cathedral.count * 3);
      Object.assign(S, { baked: { frames, rgb, index: -1 }, t: 0, playing: true });
      p.hideMsg();
      ui.bakedText.replaceChildren(`Baked frames · ${frames.seconds.toFixed(frames.seconds % 1 ? 1 : 0)} s`,
        h('span', { class: 'baked-extra', text: ` · ${mb(frames.bytes)} · no code running` }));
      shown(true);
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

const DIM = 0.15;
const NARROW = typeof matchMedia === 'function' ? matchMedia('(max-width: 899px)') : { matches: false };
const REDUCE = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const shown = new Set();     // looks whose flashing someone chose to see, this session

/**
 * The preview's flash guard: every frame shown goes through show(), which dims the view and offers a
 * banner while a large area flashes over three times a second (flash-guard.js), or while the saved
 * look's bake says it does. "Show it anyway" lasts for that look this session; reduced motion keeps
 * it dimmed.
 */
function flashGuard(S, ui) {
  let guard = null, viewer = null, guarded = false;
  const key = () => `studio.flash.${S.look.id || 'new'}`;
  const allowed = () => {
    if (REDUCE.matches) return false;
    try { return shown.has(key()) || sessionStorage.getItem(key()) === '1'; } catch { return shown.has(key()); }
  };
  const anyway = h('button', { type: 'button', class: 'btn small', text: 'Show it anyway', onClick: () => {
    shown.add(key());
    try { sessionStorage.setItem(key(), '1'); } catch { /* private mode: this page only */ }
    set(guarded);
  } });
  const text = h('span', { class: 'flash-text' });
  const banner = h('div', { class: 'viewer-msg flash-banner', role: 'status', hidden: true }, text, anyway);
  ui.viewerWrap.append(banner);
  function set(on) {
    guarded = on;
    const dim = on && !allowed();
    viewer?.setOption('gain', dim ? DIM : 1);
    banner.hidden = !dim;
    anyway.hidden = REDUCE.matches;
    text.textContent = REDUCE.matches ? 'This look flashes quickly, so it stays dimmed: your device asks for '
      + 'reduced motion.' : 'This look flashes quickly. Show it anyway?';
  }
  return {
    start(cathedral, v) { guard = new FlashGuard(cathedral); viewer = v; },
    /** Shows a frame (rgb, as the viewer takes it) seen at `now` ms. */
    show(rgb, now) {
      const flashing = guard.observe(rgb, now) || (S.server?.bake?.analysis?.flicker?.ok === false && !S.dirty);
      if (flashing !== guarded) set(flashing);
      viewer.setColors(rgb);
    },
  };
}
