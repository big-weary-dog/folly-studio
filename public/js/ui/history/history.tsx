// The History drawer beside the 3D view (SPEC-history "The History drawer"): Steps walks this session's edits;
// Versions lists the look's saved versions, newest first, to preview one in place of the work (held until "Back to
// my work") or restore it. Undo and Redo sit in its head.
import '../../../css/history.css';

import { signal } from '@preact/signals';
import { useLayoutEffect } from 'preact/hooks';

import { Drawer, type DrawerHandle } from '../drawer.tsx';
import type { Studio } from '../studio-store.ts';
import { StepsList } from './steps-list.tsx';
import { Versions } from './versions.tsx';

const tab = signal<'steps' | 'versions'>('steps');

export function HistoryDrawer({ d, st }: { d: DrawerHandle, st: Studio }) {
  const p = st.previewing.value, at = st.history.at.value, last = st.history.list.value.length - 1;
  useLayoutEffect(() => {   // the view says which version it plays
    const view = document.querySelector('.pane-viewer');
    if (p) view?.setAttribute('data-previewing', `Previewing version ${p.n}: ${p.label}`);
    else view?.removeAttribute('data-previewing');
  }, [p]);
  return <Drawer d={d} title="History" class="history-drawer" actions={<>
    <button type="button" class="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={at <= 0}
      onClick={() => st.undo()}>↶</button>
    <button type="button" class="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={at >= last}
      onClick={() => st.redo()}>↷</button></>}>
    <div class="history-tabs" role="group" aria-label="Steps or versions">
      {(['steps', 'versions'] as const).map((id) => <button type="button" class="dock-tab"
        aria-pressed={tab.value === id} onClick={() => { tab.value = id; }}>
        {id === 'steps' ? 'Steps' : 'Versions'}</button>)}</div>
    {tab.value === 'steps' ? <StepsList st={st} /> : <Versions st={st} open={d.open} />}
  </Drawer>;
}
