// A fader's hand on it: a drag along `axis` or the arrow keys set a value between min and max, sent at most once a
// frame; while a finger is on it, and briefly after, it shows the finger's value rather than the engine's last.
import { useEffect, useRef, useState } from 'preact/hooks';

const HOLD_MS = 600;   // the finger's value outlasts the drag by this, while the engine catches up

export function useDrag({ min, max, value, axis, locked, send }: { min: number, max: number, value: number,
  axis: 'x' | 'y', locked: boolean, send: (v: number) => void }) {
  const [local, setLocal] = useState<number | null>(null);
  const pending = useRef<number | null>(null), raf = useRef(0), timer = useRef(0), sendRef = useRef(send);
  sendRef.current = send;
  const shown = local ?? value;
  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(timer.current); }, []);
  function set(v: number) {
    const to = Math.min(max, Math.max(min, v));
    setLocal(to);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLocal(null), HOLD_MS);
    pending.current = to;
    raf.current ||= requestAnimationFrame(() => {
      raf.current = 0;
      if (pending.current != null) sendRef.current(pending.current);
      pending.current = null;
    });
  }
  const at = (e: PointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const share = axis === 'y' ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    set(min + share * (max - min));
  };
  const step = (max - min) / 100;
  const keys: Record<string, number> = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step,
    PageUp: step * 10, PageDown: -step * 10 };
  return {
    value: shown,
    share: (shown - min) / (max - min || 1),
    /** Forget the finger's value: the engine's is the one now (a release). */
    drop: () => setLocal(null),
    props: {
      role: 'slider' as const, tabindex: locked ? -1 : 0,
      'aria-valuemin': min, 'aria-valuemax': max, 'aria-valuenow': shown,
      'aria-disabled': locked, 'aria-orientation': axis === 'y' ? 'vertical' as const : 'horizontal' as const,
      onPointerDown(e: PointerEvent) {
        if (locked) return;
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        at(e, el);
      },
      onPointerMove(e: PointerEvent) {
        const el = e.currentTarget as HTMLElement;
        if (!locked && el.hasPointerCapture(e.pointerId)) at(e, el);
      },
      onKeyDown(e: KeyboardEvent) {
        if (locked) return;
        const d = keys[e.key];
        const to = d != null ? shown + d : e.key === 'Home' ? min : e.key === 'End' ? max : null;
        if (to == null) return;
        e.preventDefault();
        set(to);
      },
    },
  };
}
