// The Studio: groups tree · 3D view + transport · layer stack, module chain + params · code, timeline and look. This
// view holds the store (studio-store.ts) and the preview (preview.ts), loads the rig, the library and the look, and
// keeps unsaved edits from being lost; studio-layout.tsx lays the panels out.
import '../../css/compose.css'; // before studio.css, which refines some of its rules
import '../../css/studio.css';
import '../../css/params.css';
import '../../css/side.css';

import { batch } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';

import { api, statusOf } from '../api.ts';
import { leaveGuard, replaceUrl, setTitle, user, type ViewProps } from './session.ts';
import { toast } from './kit.tsx';
import { loadLibrary, loadRig } from './model.ts';
import { reportPage } from './bug-report.tsx';
import { createPreview } from './preview.ts';
import { loadReport, studioReport } from './report-studio.ts';
import { StudioLayout } from './studio-layout.tsx';
import { createStudio } from './studio-store.ts';
import { createTimeline } from './timeline-state.ts';
import { showToTour } from './tour-view.ts';

async function loadLook(id?: string) {
  try {
    return id ? (await api.look(id)).look : null;
  } catch (err) {
    toast(statusOf(err) === 404 ? 'That look was not found (or is not shared). Starting a new one.'
      : (err as Error).message, { kind: 'error' });
    replaceUrl('/studio');
    return null;
  }
}

export function Studio({ params, query }: ViewProps) {
  const [ctx] = useState(() => {
    const st = createStudio(user.peek()), pv = createPreview(st);
    return { st, pv, tl: createTimeline(st, pv), els: {} as Record<'canvas' | 'sandbox' | 'viewer', HTMLElement> };
  });
  useEffect(() => {
    const { st, pv, els } = ctx;
    let alive = true;
    setTitle('Studio');
    leaveGuard.isDirty = () => st.dirty.peek();
    leaveGuard.discard = () => { st.saved.value = JSON.stringify(st.body.peek()); };
    const library = loadLibrary().catch((err) => {
      toast(`Library unavailable: ${err.message}`, { kind: 'error' });
      return [];
    });
    const unreport = reportPage('studio', studioReport(st, pv, ctx.tl));
    // ?report=<id> (admins): a bug report's moment, replayed (report-studio.ts).
    const replay = query.get('report') ? loadReport(query.get('report')!) : null;
    const look = replay ? replay.then((r) => r.look) : loadLook(params.lookId);
    const untour = showToTour(st, pv), practice = query.get('tour');
    Promise.all([loadRig(), library, look]).then(async ([rig, lib, from]) => {
      // ?tour=<path>: the tutorial's practice look, an unsaved one made from library presets (tour/practice.ts).
      if (practice && !from) from = await (await import('./tour/practice.ts')).loadPractice(practice, lib, rig);
      if (!alive) return;
      batch(() => {   // ready with its preview set, so a tutorial step never starts on a view still changing
        st.setup(rig, lib, from);
        pv.start(els.canvas as HTMLCanvasElement, els.sandbox, els.viewer, rig, lib);
      });
      if (replay) await (await replay).apply(st, pv, ctx.tl);
    }).catch((err) => {
      if (!alive) return;
      pv.msg.value = { text: `Could not open the Studio: ${err.message}`, error: true };
      toast(err.message, { kind: 'error' });
    });
    // Ctrl/⌘+S saves; Ctrl/⌘+Z undoes and Ctrl/⌘+Shift+Z (or Ctrl+Y) redoes, unless a text field or the code editor
    // has them (their own undo); Space plays or pauses unless a control or a dialog has it.
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey, t = e.target as Element;
      if (mod && k === 's') { e.preventDefault(); st.save(); return; }
      if (mod && (k === 'z' || k === 'y') && !t.closest?.('input, textarea, select, [contenteditable], dialog')) {
        e.preventDefault();
        if (k === 'z' && !e.shiftKey) st.undo();
        else st.redo();
        return;
      }
      if (e.key !== ' ' || t.closest?.('button, input, select, textarea, [contenteditable], dialog')) return;
      e.preventDefault();
      pv.setPlaying(!st.playing.peek());
    };
    const seal = () => st.history.seal();   // a drag or a field's typing ends: its step takes no more
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerup', seal);
    document.addEventListener('focusout', seal);
    return () => {
      alive = false;
      unreport();
      untour();
      delete leaveGuard.isDirty;
      delete leaveGuard.discard;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerup', seal);
      document.removeEventListener('focusout', seal);
      pv.destroy();
      st.dispose();
    };
  }, []);
  return <StudioLayout {...ctx} />;
}
