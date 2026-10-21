// The timeline (SPEC "Timeline"): a row per layer, top first, clips on a ruler, a playhead (all that moves per
// frame, through a ref), then the modulators' lanes and the automation's. Wide: dragged in the dock
// (timeline-input.ts); phones: strips and the clip's numbers.
import '../../css/timeline.css';

import { computed, effect, useSignalEffect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Layer } from './model.ts';
import { cx, useLazy } from './kit.tsx';
import type { Preview } from './preview.ts';
import type { Studio } from './studio-store.ts';
import { attachInput } from './timeline-input.ts';
import { clock, MAX_DURATION, rulerStep, shownFades } from './timeline-model.ts';
import type { TimelineState } from './timeline-state.ts';
import { Inspector, TimelineTools } from './timeline-tools.tsx';

const RULER_H = 16;

export function Timeline({ st, pv, tl }: { st: Studio; pv: Preview; tl: TimelineState }) {
  const scroll = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const narrow = st.narrow.value, layers = st.look.value.layers, bpm = st.look.value.bpm;
  const pps = tl.pps.value, d = tl.duration.value, beatPx = bpm ? (60 / bpm) * pps : 0;

  useEffect(() => {
    const sc = scroll.current as HTMLDivElement;
    tl.setScroller(sc);
    const ro = new ResizeObserver(() => {
      if (sc.clientWidth) tl.viewW.value = Math.max(1, sc.clientWidth - tl.namesW.peek());
    });
    ro.observe(sc);
    const detach = attachInput(sc, tl, st);
    // The ruler and the playhead follow the scroll and the zoom, and the playhead the clock, with no re-render.
    let px = -1, colors: Record<string, string> | null = null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    function placeHead() {
      const h = head.current, x = sc.scrollLeft, w = tl.viewW.peek();
      if (!h) return;
      const away = !st.narrow.peek() && (px < x - 1 || px > x + w);
      if (h.hidden !== away) h.hidden = away;
      h.style.transform = `translateX(${px}px)`;
    }
    function drawRuler() {
      const cv = canvas.current, ctx = cv?.getContext('2d'), w = tl.viewW.peek(), p = tl.pps.peek();
      if (!cv || !ctx || w <= 1) return;
      if (cv.width !== Math.round(w * dpr)) Object.assign(cv, { width: Math.round(w * dpr), height: RULER_H * dpr });
      cv.style.width = `${w}px`;
      if (!colors) {
        const cs = getComputedStyle(sc), v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
        colors = { tick: v('--tl-tick', '#4d4258'), text: v('--text-3', '#a3949f'), end: v('--amber', '#f4b04f'),
          beat: v('--cobalt-t', '#9bb6ff') };
      }
      const x0 = st.narrow.peek() ? 0 : sc.scrollLeft, end = Math.min(MAX_DURATION, (x0 + w) / p);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, RULER_H);
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'top';
      const minor = rulerStep(p) / 4;
      for (let k = Math.floor(x0 / p / minor); k * minor <= end; k++) {
        const x = Math.round(k * minor * p - x0);
        ctx.fillStyle = colors.tick;
        ctx.fillRect(x, k % 4 ? 12 : 8, 1, RULER_H);
        if (k % 4 === 0) { ctx.fillStyle = colors.text; ctx.fillText(clock(k * minor), x + 3, 1); }
      }
      const b = st.look.peek().bpm, beat = b ? 60 / b : 0;
      if (beat && beat * p >= 6) {
        ctx.fillStyle = colors.beat;
        for (let k = Math.ceil(x0 / p / beat); k * beat <= end; k++) {
          ctx.fillRect(Math.round(k * beat * p - x0), 14, 1, 2);
        }
      }
      ctx.fillStyle = colors.end;
      ctx.fillRect(Math.round(tl.duration.peek() * p - x0) - 1, 0, 2, RULER_H);
    }
    const onScroll = () => { drawRuler(); placeHead(); };
    sc.addEventListener('scroll', onScroll, { passive: true });
    const offFrame = pv.onFrame((t, playing) => {
      const p = Math.round(t * tl.pps.peek());
      if (p === px) return;
      px = p;
      const x = sc.scrollLeft, w = tl.viewW.peek();
      if (playing && (p > x + w - 6 || p < x) && !st.narrow.peek() && !tl.drag.peek()) {
        sc.scrollLeft = Math.max(0, p - 16);       // its scroll event redraws the ruler
      }
      placeHead();
    });
    // Geometry changes (zoom, size, length, tempo, mode) redraw the ruler and place the playhead.
    const geometry = computed(() => [tl.pps.value, tl.viewW.value, tl.duration.value, st.look.value.bpm,
      st.narrow.value].join());
    const stopGeometry = effect(() => {
      void geometry.value;
      px = Math.round(st.clock.t * tl.pps.peek());
      drawRuler();
      placeHead();
    });
    return () => { ro.disconnect(); detach(); sc.removeEventListener('scroll', onScroll); offFrame(); stopGeometry(); };
  }, []);
  useSignalEffect(() => {    // a clip selected on another layer is let go
    const s = tl.sel.value;
    if (s && s.id !== st.selectedId.value) tl.sel.value = null;
  });

  const vars = { '--tl-names': `${tl.namesW.value}px`, '--tl-w': `${tl.contentW.value}px`, '--tl-dur': `${d * pps}px`,
    '--tl-grid': `${beatPx >= 6 ? beatPx : rulerStep(pps) * pps}px` };
  return (
    <div class={cx('tl', beatPx >= 6 && 'beats', !layers.length && 'tl-empty', tl.drag.value && 'dragging')}
      data-mode={narrow ? 'narrow' : 'wide'} style={vars}>
      {narrow && <TimelineTools st={st} tl={tl} />}
      <div class="tl-scroll" ref={scroll} tabindex={-1} role="group" aria-label={'Timeline, top layer first. On a '
        + 'selected clip, arrows move it, Shift+arrows change its length and Delete removes it.'}>
        <div class="tl-inner">
          <div class="tl-head-row"><div class="tl-corner">Layers</div>
            <div class="tl-ruler" title="Click or drag to move the playhead">
              <canvas class="tl-ruler-canvas" ref={canvas} aria-hidden="true" /></div></div>
          <div class="tl-rows">{[...layers].reverse().map((l) => <Row key={l.id} l={l} st={st} tl={tl} />)}</div>
          <Modulators st={st} tl={tl} />
          <Automation st={st} tl={tl} />
          <div class="tl-playhead" ref={head} aria-hidden="true" />
        </div>
      </div>
      {narrow && <Inspector st={st} tl={tl} />}
    </div>);
}

function Row({ l, st, tl }: { l: Layer; st: Studio; tl: TimelineState }) {
  const clips = tl.clipsOf(l), pps = tl.pps.value, title = l.title || 'Layer', s = tl.sel.value;
  const selIndex = s?.id === l.id ? s.index : -1, d = tl.duration.value;
  return (
    <div class={cx('tl-row', l.id === st.selectedId.value && 'selected')} data-id={l.id} data-blend={l.blend || 'add'}>
      <button type="button" class="tl-name" onClick={() => st.select(l.id)}>{title}</button>
      <div class="tl-lane">
        <div class="tl-always" hidden={clips.length > 0}>
          <span>{st.narrow.value ? 'Always on' : 'Always on · double-click to place a clip'}</span></div>
        {clips.map((c, i) => {
          const [fi, fo] = shownFades(c);     // as they play: a short clip squeezes long fades
          const when = `${clock(c.start)} to ${clock(c.end)}`;
          const fades = c.fadeIn || c.fadeOut ? `, fading in ${c.fadeIn} s and out ${c.fadeOut} s` : '';
          return (
            <div key={i} class={cx('tl-clip', i === selIndex && 'selected', c.start >= d && 'past-end')} tabindex={0}
              role="button" data-i={i} title={when + fades}
              aria-label={`${title}, clip ${i + 1} of ${clips.length}: ${when}${fades}`}
              style={{ left: `${c.start * pps}px`, width: `${Math.max(2, (c.end - c.start) * pps)}px`,
                '--fi': `${fi * pps}px`, '--fo': `${fo * pps}px` }}
              onFocus={() => { if (selIndex !== i) tl.selectClip(l.id, i); }}>
              <span class="tl-ramp tl-ramp-in" /><span class="tl-ramp tl-ramp-out" />
              <span class="tl-fh tl-fh-in" title="Drag to fade in" />
              <span class="tl-fh tl-fh-out" title="Drag to fade out" />
            </div>);
        })}
      </div>
    </div>);
}

// Modulator lanes (timeline-mods.tsx) load once a look has a modulator.
function Modulators({ st, tl }: { st: Studio; tl: TimelineState }) {
  const has = Object.values(st.look.value.globals?.macros ?? {}).some((m) => m.mod);
  const mod = useLazy(() => import('./timeline-mods.tsx'), has);
  return mod && has ? <mod.ModLanes st={st} tl={tl} /> : null;
}

// Automation lanes (timeline-auto.tsx) load once a look has some or asks for some.
function Automation({ st, tl }: { st: Studio; tl: TimelineState }) {
  const [asked, setAsked] = useState(false);
  const mod = useLazy(() => import('./timeline-auto.tsx'), asked || !!st.look.value.automation);
  if (mod) return <mod.AutoLanes st={st} tl={tl} focus={asked} />;
  return (
    <div class="tl-auto-head"><div class="tl-corner tl-auto-corner">Automation</div>
      <div class="tl-auto-tools"><button type="button" class="btn small" onClick={() => setAsked(true)}
        data-tour="automate">+ Automate…</button></div></div>);
}
