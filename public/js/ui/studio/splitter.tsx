// A divider that sizes a pane as a share of its box, dragged by any pointer or moved with the arrows, kept per
// browser (`pref`) and set on the box's style as `prop`.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { pref } from '../kit.tsx';

type Props = {
  box: { current: HTMLElement | null }; pane: string; prop: string; keep: string; min: number; max: number;
  /** The share the arrows start from while none is set. */
  rest: number;
  /** 1 when the pane grows as the divider moves down, -1 when it grows as it moves up. */
  grows: 1 | -1;
  class: string; label: string; title?: string;
  /** Double click goes back to the stylesheet's size, and the box carries `sized` while one is set. */
  reset?: boolean;
  onResizing?: (on: boolean) => void;
};

export function Splitter({ box, pane, prop, keep, min, max, rest, grows, class: cls, label, title, reset,
  onResizing }: Props) {
  const [now, setNow] = useState(() => { const v = Number(pref(keep)); return v >= min && v <= max ? v : 0; });
  const drag = useRef<{ y: number; h: number; total: number } | null>(null);
  const set = (pct: number) => {
    setNow(pct);
    pref(keep, pct ? pct.toFixed(1) : '');
  };
  const within = (pct: number) => Math.min(max, Math.max(min, pct));
  useLayoutEffect(() => {
    box.current?.style.setProperty(prop, now ? `${now.toFixed(1)}%` : '');
    if (reset) box.current?.classList.toggle('sized', !!now);
  }, [now]);
  const end = () => { if (drag.current) { drag.current = null; onResizing?.(false); } };
  return (
    <div class={cls} role="separator" aria-orientation="horizontal" tabindex={0} aria-label={label} title={title}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={now ? Math.round(now) : undefined}
      onPointerDown={(e) => {
        const b = box.current, p = b?.querySelector(pane);
        if (!b || !p) return;
        drag.current = { y: e.clientY, h: p.getBoundingClientRect().height, total: b.getBoundingClientRect().height };
        e.currentTarget.setPointerCapture(e.pointerId);
        onResizing?.(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) set(within(((d.h + grows * (e.clientY - d.y)) / d.total) * 100));
      }}
      onPointerUp={end} onPointerCancel={end}
      onDblClick={reset ? () => set(0) : undefined}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowUp' ? -4 : e.key === 'ArrowDown' ? 4 : 0;
        if (!step) return;
        e.preventDefault();
        set(within((now || rest) + grows * step));
      }} />);
}
