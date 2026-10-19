// A touch fader for the controller: the whole strip is the target (drag across it; vertical drags still scroll the
// page), its fill the value, sending at most 20 times a second while dragged and the last value on release. Arrow
// keys step it by 1 % (Shift: 10 %).
import { useRef, useState } from 'preact/hooks';

import { cx } from '../kit.tsx';

const SEND_MS = 50;
type Props = { label: string, min: number, max: number, value: number, held?: boolean, onSet: (v: number) => void,
  onRelease?: () => void };
const fmt = (v: number, span: number) => v.toFixed(span >= 10 ? 1 : 2);

export function Fader({ label, min, max, value, held, onSet, onRelease }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const timer = useRef(0), last = useRef(0), next = useRef<number | null>(null);
  const shown = drag ?? value, span = max - min, frac = span > 0 ? (shown - min) / span : 0;
  const flush = () => {
    timer.current = 0;
    if (next.current === null) return;
    last.current = performance.now();
    onSet(next.current);
    next.current = null;
  };
  const push = (v: number, now = false) => {
    next.current = v;
    if (now) { clearTimeout(timer.current); flush(); return; }
    const wait = SEND_MS - (performance.now() - last.current);
    if (wait <= 0) flush(); else if (!timer.current) timer.current = window.setTimeout(flush, wait);
  };
  const at = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return min + span * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const move = (e: PointerEvent) => {
    if (drag === null) return;
    const v = at(e);
    setDrag(v);
    push(v);
  };
  const end = (e: PointerEvent) => {
    if (drag === null) return;
    const v = e.type === 'pointercancel' ? drag : at(e);
    setDrag(null);
    push(v, true);
  };
  const key = (e: KeyboardEvent) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    push(Math.min(max, Math.max(min, value + d * span * (e.shiftKey ? 0.1 : 0.01))), true);
  };
  return (
    <div class={cx('fader-row', held && 'held')}>
      <div class="fader" role="slider" tabindex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max}
        aria-valuenow={shown} aria-valuetext={fmt(shown, span)} onKeyDown={key}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const v = at(e);
          setDrag(v);
          push(v);
        }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <span class="fader-fill" style={{ width: `${(frac * 100).toFixed(2)}%` }} />
        <span class="fader-label">{label}</span>
        <span class="fader-value">{fmt(shown, span)}</span>
      </div>
      {onRelease && <button type="button" class="btn small ghost fader-release" disabled={!held}
        title={`Back to the look's own ${label.toLowerCase()}`} aria-label={`Release ${label}`}
        onClick={onRelease}>↺</button>}
    </div>);
}
