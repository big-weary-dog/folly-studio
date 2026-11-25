// The side column on a wide screen: Layers over Settings, each able to take the whole column or fold to its head
// (its title folds it, ⤢ expands it, a click on its head's bare space folds it too), and the divider sizing the split.
import { Splitter } from './splitter.tsx';
import type { SideView, Studio } from './store.ts';

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

/** The divider between them sizes Layers (a share of the column); a double click resets. */
export const SideDivider = ({ box }: { box: { current: HTMLDivElement | null } }) => (
  <Splitter box={box} pane=".pane-layers" prop="--layers-h" keep="studio.sideSplit" min={15} max={85} rest={50}
    grows={1} class="side-divider" label="Resize layers and settings" title="Drag to resize; double-click to reset"
    reset />);
