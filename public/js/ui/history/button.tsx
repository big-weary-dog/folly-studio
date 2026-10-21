// The toolbar's History button: it opens the History drawer (history.tsx, loaded on first use) beside the view.
// Undo and redo need no drawer: they are the store's (steps.ts).
import { useDrawer } from '../drawer.tsx';
import { cx, useLazy } from '../kit.tsx';
import type { Studio } from '../studio-store.ts';

export function HistoryButton({ st }: { st: Studio }) {
  const d = useDrawer(), H = useLazy(() => import('./history.tsx'), d.open);
  return <>
    <button type="button" class={cx('btn history-btn', d.open && 'is-on')} aria-expanded={d.open} onClick={d.toggle}
      title="History and versions">History</button>
    {H && <H.HistoryDrawer d={d} st={st} />}</>;
}
