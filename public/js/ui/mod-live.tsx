// Modulation as it plays (SPEC "Param bindings", "Globals"): a binding's value now, read on the main thread from the
// look as edited (its lanes, modulators and tempo) and show time; a bound row's live chip; an LFO's wave.
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Binding, Clip, ParamValue } from '../../../shared/schemas/look.ts';
import type { ParamSchema } from '../core/compile.ts';
import { modValue, paramMods, prepareLook, type PreparedLook } from '../core/globals.ts';
import { layerEnvelope } from '../core/timeline.ts';
import { bindingText, fmt, makeBinding, type BindingForm, type Param } from './bindings.ts';
import { cx, decimals } from './kit.tsx';

type LookLike = NonNullable<Parameters<typeof prepareLook>[0]>;
/** Where a binding plays: the look (its globals, lanes and tempo), show time now, the layer's clips; `self` the
 * macro being edited (a modulator follows faders only); `share` makes a modulator of an LFO, returning its name. */
export type ModCtx = { look: () => LookLike; t: () => number; clips: () => readonly Clip[] | null | undefined;
  narrow: boolean; self?: string; share?: (mod: Binding, hint: string) => string;
  edit?: { rename: (from: string, to: string) => boolean; mod: (name: string, v: ParamValue | undefined) => void } };

const prepared = new WeakMap<object, PreparedLook>();
const lookFor = (look: LookLike) => {
  let L = prepared.get(look);
  if (!L) prepared.set(look, L = prepareLook(look));
  return L;
};

/** A binding's value at show time t on p's range (`wrap`: a rotate, unbounded and shown as its turn 0..1). */
export function boundValue(b: Binding, p: Param, ctx: ModCtx, t: number, wrap = false) {
  const spec = { type: 'number', value: p.value, min: wrap ? -1e6 : p.min, max: wrap ? 1e6 : p.max };
  const [m] = paramMods({ v: spec } as unknown as ParamSchema, { v: b });
  if (!m) return NaN;
  const L = lookFor(ctx.look()), v = modValue(m, t, m.kind === 1 ? L.normAt(m.name, t) : 0,
    layerEnvelope(ctx.clips(), t), L);
  return wrap ? v - Math.floor(v) : v;
}

/** A global or macro now, 0..1 of its range. */
export const normNow = (ctx: ModCtx, name: string) => lookFor(ctx.look()).normAt(name, ctx.t());

/** Re-renders every `ms` while `read()` changes (show time while playing): nothing while paused. */
export function useFollow(read: () => unknown, ms = 100) {
  const [, bump] = useState(0), last = useRef(read());
  useEffect(() => {
    const id = setInterval(() => {
      const v = read();
      if (v !== last.current) { last.current = v; bump((n) => n + 1); }
    }, ms);
    return () => clearInterval(id);
  }, []);
}

/** A bound row's chip: its kind and range, its value now and a bar where that sits in the range. */
export function BoundChip({ b, p, ctx, wrap }: { b: Binding; p: Param; ctx: ModCtx; wrap?: boolean }) {
  useFollow(() => ctx.t());
  const v = boundValue(b, p, ctx, ctx.t(), wrap), at = Math.min(1, Math.max(0, (v - p.min) / (p.max - p.min)));
  const text = bindingText(b, p);
  return <span class={cx('param-chip', `mod-${b.mod}`)} title={text}>
    <span class="chip-text">{text}</span><span class="chip-val">{Number.isFinite(v)
      ? v.toFixed(Math.max(decimals(p.step), 1)) : '–'}</span>
    <i class="chip-bar" style={{ width: `${(at * 100).toFixed(1)}%` }} /></span>;
}

/** A global's or macro's value now as a bar (the popover's list of what a param can follow). */
export function NowBar({ ctx, name }: { ctx: ModCtx; name: string }) {
  useFollow(() => ctx.t());
  return <span class="mod-now" aria-hidden="true"><i style={{ width: `${(normNow(ctx, name) * 100).toFixed(1)}%` }} />
  </span>;
}

const W = 340, H = 44;
/** An LFO's wave over two cycles (at its pace now) inside the param's range band, the playhead a dot on it. */
export function Wave({ f, p, ctx }: { f: BindingForm; p: Param; ctx: ModCtx }) {
  useFollow(() => ctx.t(), 50);
  const b = makeBinding(f, p);
  if (!b || b.mod !== 'lfo') return null;
  const L = lookFor(ctx.look()), t = ctx.t(), pace = b.pace ? (L.paceAt(b.pace, t + 0.01) - L.paceAt(b.pace, t)) / 0.01
    : 1, rate = Math.max(1e-3, (b.rate ?? 1) * pace) * (b.unit === 'beats' ? (ctx.look().bpm || 120) / 60 : 1);
  const span = 2 / rate, t0 = t - (t % span), c = b.center ?? 0, d = Math.abs(b.depth ?? 0);
  const lo = Math.min(p.min, c - d), hi = Math.max(p.max, c + d);
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
  const pts = Array.from({ length: 121 }, (_, i) => `${(i / 120) * W},${y(boundValue(b, p, ctx, t0 + (i / 120) * span))
    .toFixed(1)}`).join(' ');
  return <svg class="mod-wave" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The LFO over two cycles">
    <rect class="mod-band" x="0" width={W} y={y(p.max)} height={Math.max(0, y(p.min) - y(p.max))} />
    <line class="mod-mid" x1={W / 2} x2={W / 2} y1="0" y2={H} />
    <polyline class="mod-line" points={pts} />
    <circle class="mod-dot" cx={((t - t0) / span) * W} cy={y(boundValue(b, p, ctx, t))} r="4" />
    <text x="4" y="11">{fmt(p.max)}</text><text x="4" y={H - 3}>{fmt(p.min)}</text></svg>;
}
