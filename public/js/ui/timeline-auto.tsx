// Automation lanes under the timeline's layers (SPEC "Looks"): a lane per automated macro, its
// points joined by straight lines and held at either end. Click a lane to add a point, drag one to move it,
// double-click one to remove it.
import { useId, useLayoutEffect, useRef } from 'preact/hooks';

import { MAX_MACROS, MAX_POINTS } from '../core/globals.ts';
import type { Automation } from '../../../shared/schemas/look.ts';
import { humanize } from './kit.tsx';
import { automate } from './automation-edit.ts';
import type { Studio } from './studio-store.ts';
import { clock } from './timeline-model.ts';
import type { TimelineState } from './timeline-state.ts';

const H = 42, PAD = 8;              // room for full endpoint circles, including their strokes
type Range = { min: number; max: number; value: number };
type Point = [number, number];
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const automationLevel = (v: number, range: Range) => v <= range.min ? 'low' : v >= range.max ? 'high' : 'mid';

export function AutoLanes({ st, tl, focus }: { st: Studio; tl: TimelineState; focus: boolean }) {
  const L = st.look.value, auto = L.automation || {}, add = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => { if (focus) add.current?.focus(); }, []);
  // What can be automated: the look's macros, with their ranges.
  const ranges = new Map<string, Range>(Object.entries(L.globals?.macros || {}));
  const free = [...ranges.keys()].filter((n) => !auto[n]);
  const setLanes = (fn: (a: Automation) => void) => st.edit((look) => {
    const a = { ...look.automation };
    fn(a);
    return { automation: Object.keys(a).length ? a : undefined };
  });
  const addLane = (name: string) => {
    const r = ranges.get(name);
    if (r) setLanes((a) => { a[name] = [[0, r.value], [r3(tl.duration.peek()), r.value]]; });
  };
  return (
    <div class="tl-auto">
      <div class="tl-auto-head"><div class="tl-corner tl-auto-corner">Automation</div>
        <div class="tl-auto-tools"><select class="tl-auto-add" ref={add} aria-label="Automate a macro" value=""
          data-tour="automate" disabled={!free.length && ranges.size >= MAX_MACROS}
          onChange={(e) => e.currentTarget.value === ':new' ? automate(st) : addLane(e.currentTarget.value)}>
          <option value="">+ Automate…</option>
          {free.map((n) => <option value={n}>{humanize(n)}</option>)}
          <option value=":new" disabled={ranges.size >= MAX_MACROS}>New automation…</option></select></div></div>
      <div class="tl-auto-lanes">
        {Object.keys(auto).filter((n) => ranges.has(n)).map((n) => <Lane key={n} name={n} pts={auto[n]!}
          range={ranges.get(n) as Range} tl={tl} get={() => st.look.peek().automation?.[n] || []}
          set={(pts) => setLanes((a) => { if (pts) a[n] = pts; else delete a[n]; })} />)}
      </div>
    </div>);
}

function Lane({ name, pts, range, tl, get, set }: { name: string; pts: Point[]; range: Range; tl: TimelineState;
  get: () => Point[]; set: (pts: Point[] | null) => void }) {
  const svg = useRef<SVGSVGElement>(null), drag = useRef<Point | null>(null);
  const gradient = useId();
  const w = tl.contentW.value || 1, pps = tl.pps.value, span = range.max - range.min || 1;
  const xy = pts.map(([t, v]) => [t * pps, PAD + (1 - (v - range.min) / span) * (H - 2 * PAD)]);
  const line = [[0, xy[0][1]], ...xy, [w, xy[xy.length - 1][1]]].map((p) => p.join(',')).join(' ');
  /** Pointer → [t, v] on the lane (t snapped like clips, within the look; v within the range). */
  function at(e: PointerEvent): Point {
    const box = (svg.current as SVGSVGElement).getBoundingClientRect(), step = tl.step();
    let t = Math.max(0, Math.min(tl.duration.peek(), (e.clientX - box.left) / tl.pps.peek()));
    if (step) t = Math.round(t / step) * step;
    const k = Math.max(0, Math.min(1, 1 - (e.clientY - box.top - PAD) / (H - 2 * PAD)));
    return [r3(t), r3(range.min + k * (range.max - range.min))];
  }
  const sorted = (list: Point[]) => list.sort((a, b) => a[0] - b[0]);
  function down(e: PointerEvent) {
    if (e.button !== 0 || e.detail > 1) return;
    const i = (e.target as SVGElement).dataset?.i, now = get();
    let point = i !== undefined ? now[Number(i)] : null;
    if (!point) {
      const p = at(e);
      if (now.length >= MAX_POINTS || now.some((q) => q[0] === p[0])) return;
      point = p;
      set(sorted([...now, p]));
    }
    drag.current = point;
    svg.current?.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    const was = drag.current;
    if (!was) return;
    const now = get(), [t, v] = at(e), p: Point = [now.some((q) => q !== was && q[0] === t) ? was[0] : t, v];
    drag.current = p;
    set(sorted(now.map((q) => (q === was ? p : q))));
  }
  const up = () => { drag.current = null; };
  // The lane holds the pointer from its press, so a double-click lands on the lane: take the dot under it.
  function remove(e: MouseEvent) {
    const box = (svg.current as SVGSVGElement).getBoundingClientRect(), now = get();
    const i = xy.findIndex(([x, y]) => Math.hypot(x - (e.clientX - box.left), y - (e.clientY - box.top)) <= 7);
    if (i >= 0 && now.length > 1) set(now.filter((_, j) => j !== i));
  }
  return (
    <div class="tl-row tl-auto-row" data-name={name} data-tour-area>
      <div class="tl-name tl-auto-label"><span class="tl-auto-name">{humanize(name)}</span>
        <button type="button" class="tl-auto-del" aria-label={`Stop automating ${name}`} title="Remove this lane"
          onClick={() => set(null)}>×</button></div>
      <div class="tl-lane tl-auto-lane" data-tour={`lane:${name}`}>
        <svg class="tl-auto-svg" ref={svg} width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img"
          aria-label={`${name}: ${pts.map(([t, v]) => `${clock(t)} ${v}`).join(', ')}`} onPointerDown={down}
          onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDblClick={remove}>
          <defs><linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={PAD} y2={H - PAD}>
            <stop offset="0" class="tl-auto-high" /><stop offset="0.5" class="tl-auto-mid" />
            <stop offset="1" class="tl-auto-low" /></linearGradient></defs>
          <polyline class="tl-auto-line" points={line} style={{ stroke: `url(#${gradient})` }} />
          {xy.map(([x, y], i) => <g>
            <circle class="tl-auto-dot" r={5.5} cx={x} cy={y} data-i={i}
              data-level={automationLevel(pts[i][1], range)} />
            {automationLevel(pts[i][1], range) === 'mid' && <path class="tl-auto-half"
              d="M 0 -5.5 A 5.5 5.5 0 0 0 0 5.5 Z" transform={`translate(${x} ${y})`} />}
          </g>)}
        </svg>
      </div>
    </div>);
}
