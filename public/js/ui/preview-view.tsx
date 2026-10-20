// The 3D view's pane: the canvas the viewer draws on, the camera views, Ghost, Playa | Points and the Playa's
// quality (Auto: by device, then stepping down while frames are slow), the messages over the view (loading, baked
// frames, the flash guard), and the transport. The time and the stats are signals bound straight to their text.
import '../../css/viewer.css';

import { useComputed, useSignalEffect } from '@preact/signals';
import { useEffect, useId, useRef } from 'preact/hooks';

import { cx } from './kit.tsx';
import type { Preview } from './preview.ts';
import { Rose } from './rose.tsx';
import type { Studio } from './studio-store.ts';

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
export const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e8 ? 1 : 0)} MB`;
type Props = { st: Studio; pv: Preview };

export function PreviewPane({ st, pv, els }: Props & { els: Record<string, HTMLElement> }) {
  const bar = useRef<HTMLDivElement>(null), compact = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null), transport = useRef<HTMLDivElement>(null);
  const views = pv.views.value, view = pv.view.value, msg = pv.msg.value, baked = pv.bakedInfo.value;
  // Views frame what the buttons over the view leave clear; phones' toasts sit just above the transport.
  const measure = () => {
    const b = [bar.current, compact.current].find((el) => el?.offsetHeight);
    pv.viewer?.setOption('insetTop', b ? b.offsetTop + b.offsetHeight + 4 : 0);
    const top = st.narrow.peek() ? transport.current?.getBoundingClientRect().top || 0 : 0;
    const root = document.documentElement.style;
    if (top > 0) root.setProperty('--toasts-bottom', `${Math.round(innerHeight - top + 8)}px`);
    else root.removeProperty('--toasts-bottom');
  };
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    for (const el of [bar.current, compact.current, pane.current]) if (el) ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--toasts-bottom'); };
  }, []);
  useEffect(measure, [views.length]);
  return (
    <section class="pane pane-viewer" aria-label="Preview" ref={pane}>
      <div class="viewer" ref={(el) => { if (el) els.viewer = el; }}>
        <canvas class="viewer-canvas" tabindex={0} ref={(el) => { if (el) els.canvas = el; }} aria-label={'3D preview. '
          + 'Drag to orbit, scroll or pinch to zoom, right-drag or two fingers to pan, double-click to reset. With '
          + 'focus: arrow keys orbit, Alt+arrows pan, plus and minus zoom.'} />
        <div class="view-bar" role="group" aria-label="Camera views" ref={bar}>
          {views.map((name) => <button type="button" class="view-btn" data-view={name} aria-pressed={view === name}
            onClick={() => pv.viewer?.setView(name)} title={name === 'fit'
              ? 'Frame the whole installation (double-click the view does this too)' : `The “${name}” view`}>
            {cap(name)}</button>)}
          {views.length > 0 && <ViewTools pv={pv} />}
        </div>
        <div class="view-compact" ref={compact}>
          <select class="view-select" aria-label="Camera view" value={view || ''}
            onChange={(e) => { if (e.currentTarget.value) pv.viewer?.setView(e.currentTarget.value); }}>
            {views.map((name) => <option value={name}>{cap(name)}</option>)}
            {views.length > 0 && <option value="" disabled>Free camera</option>}</select>
          {views.length > 0 && <ViewTools pv={pv} />}
        </div>
        <div class={cx('viewer-msg', msg?.error && 'error')} role="status" hidden={!msg}>
          {msg && !msg.error && <Rose detail="full" class="rose-loader" />}{msg?.text}</div>
        <div class="baked-badge" role="status" hidden={!baked}><span class="baked-dot" aria-hidden="true" />
          <span class="baked-text">{baked && `Baked frames · ${baked.seconds.toFixed(baked.seconds % 1 ? 1 : 0)} s`}
            <span class="baked-extra">{baked && ` · ${mb(baked.bytes)} · no code running`}</span></span>
          <button type="button" class="btn small" onClick={() => pv.playBaked(false)}>Back to live</button></div>
        <FlashBanner pv={pv} />
      </div>
      <Transport st={st} pv={pv} el={transport} />
    </section>);
}

/** Over a look that flashes fast: dimmed, with Show it anyway and Don't dim for me; or, when this person turned
 * dimming off, a note that turns it back on. */
function FlashBanner({ pv }: { pv: Preview }) {
  const dimmed = pv.dimmed.value, off = pv.flashing.value && !pv.dimFlashes.value;
  return (
    <div class={cx('viewer-msg flash-banner', off && 'off')} role="status" hidden={!dimmed && !off}>
      <span class="flash-text">{off ? 'Flashing quickly: not dimmed for you.'
        : REDUCE.matches ? 'This look flashes quickly, so it stays dimmed: your device asks for reduced motion.'
        : 'This look flashes quickly. Show it anyway?'}</span>
      <button type="button" class="btn small" hidden={off || REDUCE.matches} onClick={pv.showAnyway}>
        Show it anyway</button>
      <button type="button" class="btn small ghost" title={off ? 'Dim fast-flashing previews again'
        : 'Stop dimming fast-flashing previews for you, on this browser'}
        onClick={() => pv.setDimFlashes(off)}>{off ? 'Dim it' : 'Don\u2019t dim for me'}</button>
    </div>);
}

/** Ghost (unlit LEDs shown faintly), Venue (props round the rig), then Playa | Points and the Playa's quality. */
function ViewTools({ pv }: { pv: Preview }) {
  const quality = pv.quality.value, tier = pv.tier.value;
  return <>
    <button type="button" class="view-btn ghost-btn" title="Show unlit LEDs faintly" aria-pressed={pv.ghost.value}
      onClick={() => pv.setGhost(!pv.ghost.peek())}>Ghost</button>
    <button type="button" class="view-btn venue-btn" title="Show the venue round the rig: walls, walkways, ground"
      aria-pressed={pv.venue.value} onClick={() => pv.setVenue(!pv.venue.peek())}>Venue</button>
    <div class="view-modes" role="group" aria-label="Render style">
      {(['playa', 'points'] as const).map((m) => <button type="button" class="view-btn mode-btn" data-mode={m}
        aria-pressed={pv.mode.value === m} onClick={() => pv.setMode(m)} title={m === 'playa'
          ? 'The night playa: glowing tubes, glass and floods' : 'Every LED a point of light: the lightest view'}>
        {cap(m)}</button>)}
      <button type="button" class="view-btn quality-btn" hidden={pv.mode.value !== 'playa'} onClick={pv.nextQuality}
        title={`Playa quality: ${quality}${tier && quality === 'auto' ? `, now ${tier}` : ''}. Click to change.`}>
        {cap(quality)}</button>
    </div></>;
}

/** Play/pause, restart, the time, scrub and speed. */
function Transport({ st, pv, el }: Props & { el: { current: HTMLDivElement | null } }) {
  const playing = st.playing.value, ids = [useId(), useId()], scrub = useRef<HTMLInputElement>(null);
  const scrubbing = useRef(false), text = useComputed(() => `${clock(pv.time.value)} / ${clock(pv.duration.value)}`);
  useSignalEffect(() => {
    const t = pv.time.value;
    if (scrub.current && !scrubbing.current) scrub.current.value = String(t);
  });
  const hold = (on: boolean) => () => { scrubbing.current = on; };
  return (
    <div class="transport" role="group" aria-label="Transport" ref={el}>
      <button type="button" class="tp-btn tp-restart" aria-label="Back to start" title="Back to start"
        onClick={() => pv.seek(0)} />
      <button type="button" class={cx('tp-play', playing && 'playing')} aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => pv.setPlaying(!st.playing.peek())} />
      <span class="tp-time" aria-label="Time">{text}</span>
      <label for={ids[0]} class="sr-only">Scrub time</label>
      <input type="range" id={ids[0]} class="tp-scrub" ref={scrub} min={0} max={pv.duration.value} step={0.01}
        onInput={(e) => pv.seek(Number(e.currentTarget.value))} onPointerDown={hold(true)} onPointerUp={hold(false)}
        onBlur={hold(false)} />
      <label for={ids[1]} class="sr-only">Speed</label>
      <select id={ids[1]} class="tp-speed" value={String(st.speed.value)}
        onChange={(e) => { st.speed.value = Number(e.currentTarget.value); }}>
        {[0.25, 0.5, 1, 2, 4].map((s) => <option value={String(s)}>{s}×</option>)}</select>
      <span class="tp-stats" aria-hidden="true">{pv.stats}</span>
    </div>);
}
