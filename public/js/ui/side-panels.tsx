// The side column on a wide screen: Layers over Settings, each able to take the whole column or fold to its head
// (its title folds it, ⤢ expands it, a click on its head's bare space folds it too), and the divider sizing the split.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { pref } from './kit.tsx';
import type { SideView, Studio } from './studio-store.ts';

type Panel = 'layers' | 'params';
const NAMES: Record<Panel, string> = { layers: 'Layers', params: 'Settings' };
const other = (p: Panel): Panel => (p === 'layers' ? 'params' : 'layers');

/** What a click on a panel's head (or its ▾) does: fold it, or unfold it back to the split. */
const folding = (side: SideView, p: Panel): SideView => (side === other(p) ? 'split' : other(p));

/** A panel's title: on a wide screen, the button that folds it to its head or unfolds it. */
export function SideFold({ st, panel }: { st: Studio; panel: Panel }) {
  const side = st.side.value, name = NAMES[panel], folded = side === other(panel);
  if (st.narrow.value) return <>{name}</>;
  return <button type="button" class="side-fold" aria-expanded={!folded}
    title={folded ? `Show ${name}` : `Collapse ${name} to its header`}
    onClick={() => st.showSide(folding(side, panel))}>{name}</button>;
}

/** ⤢ at the end of a panel's head: it takes the whole column (the other folds), or ⤡ gives back the split. */
export function SideExpand({ st, panel }: { st: Studio; panel: Panel }) {
  const big = st.side.value === panel;
  const label = big ? `Restore ${NAMES.layers} and ${NAMES.params}` : `Expand ${NAMES[panel]} to the whole column`;
  if (st.narrow.value) return null;
  return <button type="button" class="icon-btn side-expand" aria-label={label} title={label} aria-pressed={big}
    onClick={() => st.showSide(big ? 'split' : panel)}>{big ? '⤡' : '⤢'}</button>;
}

/** A click on a head's bare space (not its buttons or fields) folds or unfolds that panel. */
export function onSideHead(st: Studio, e: MouseEvent) {
  const t = e.target as Element, head = t.closest('.side .pane-head');
  if (!head || t.closest('button, input, select, a, label')) return;
  st.showSide(folding(st.side.peek(), head.closest('.pane-layers') ? 'layers' : 'params'));
}

/** The divider between them sizes Layers (a share of the column), set on the column's style; a double click resets. */
export function SideDivider({ side }: { side: { current: HTMLDivElement | null } }) {
  const [now, setNow] = useState(() => {
    const v = Number(pref('studio.sideSplit'));
    return v >= 15 && v <= 85 ? v : 0;
  });
  const drag = useRef<{ y: number; h: number; total: number } | null>(null);
  const set = (pct: number) => {
    setNow(pct);
    pref('studio.sideSplit', pct ? pct.toFixed(1) : '');
  };
  useLayoutEffect(() => {
    side.current?.style.setProperty('--layers-h', now ? `${now.toFixed(1)}%` : '');
    side.current?.classList.toggle('sized', !!now);
  }, [now]);
  return (
    <div class="side-divider" role="separator" aria-orientation="horizontal" tabindex={0}
      aria-label="Resize layers and settings" title="Drag to resize; double-click to reset" aria-valuemin={15}
      aria-valuemax={85} aria-valuenow={now ? Math.round(now) : undefined}
      onPointerDown={(e) => {
        const s = side.current, pane = s?.querySelector('.pane-layers');
        if (!s || !pane) return;
        const total = s.getBoundingClientRect().height;
        drag.current = { y: e.clientY, h: pane.getBoundingClientRect().height, total };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) set(Math.min(85, Math.max(15, ((d.h + e.clientY - d.y) / d.total) * 100)));
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onDblClick={() => set(0)}
      onKeyDown={(e) => {
        const cur = now || 50;
        if (e.key === 'ArrowUp') { e.preventDefault(); set(Math.max(15, cur - 4)); }
        if (e.key === 'ArrowDown') { e.preventDefault(); set(Math.min(85, cur + 4)); }
      }} />);
}
