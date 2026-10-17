// The Studio's preview: the 3D view and its camera buttons, the sandbox runtime, and the one clock
// that plays the look (or its baked frames) and pumps frames to the sandbox.
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
      onFrame: (rgb) => p.viewer?.setColors(rgb),
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
      if (i !== B.index && viewer) { B.index = i; viewer.setColors(B.frames.frameAt(i, B.rgb)); }
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
    document.removeEventListener('visibilitychange', onVisibility);
    bakedLoad++;
    S.baked = null;
    io?.disconnect();
    p.runtime?.destroy();
    p.viewer?.destroy();
  };
  return p;
}
