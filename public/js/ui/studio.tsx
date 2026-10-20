// The Studio: groups tree · 3D view + transport · layer stack, module chain + params · code, timeline and look. This
// view holds the store (studio-store.ts) and the preview (preview.ts), loads the rig, the library and the look, and
// keeps unsaved edits from being lost; studio-layout.tsx lays the panels out.
import '../../css/compose.css'; // before studio.css, which refines some of its rules
import '../../css/studio.css';
import '../../css/params.css';
import '../../css/side.css';

import { useEffect, useState } from 'preact/hooks';

import { api, statusOf } from '../api.ts';
import { leaveGuard, replaceUrl, setTitle, signedOut, user, type ViewProps } from './session.ts';
import { toast } from './kit.tsx';
import { loadLibrary, loadRig } from './model.ts';
import { reportPage } from './bug-report.tsx';
import { createPreview } from './preview.ts';
import { loadReport, studioReport } from './report-studio.ts';
import { StudioLayout } from './studio-layout.tsx';
import { createStudio } from './studio-store.ts';
import { createTimeline } from './timeline-state.ts';

async function loadLook(id?: string) {
  try {
    return id ? (await api.look(id)).look : null;
  } catch (err) {
    if (statusOf(err) === 401) throw err;
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
    Promise.all([loadRig(), library, look]).then(async ([rig, lib, from]) => {
      if (!alive) return;
      st.setup(rig, lib, from);
      pv.start(els.canvas as HTMLCanvasElement, els.sandbox, els.viewer, rig, lib);
      if (replay) await (await replay).apply(st, pv, ctx.tl);
    }).catch((err) => {
      if (!alive) return;
      if (statusOf(err) === 401) return signedOut();
      pv.msg.value = { text: `Could not open the Studio: ${err.message}`, error: true };
      toast(err.message, { kind: 'error' });
    });
    // Ctrl/⌘+S saves; Space plays or pauses unless a control or a dialog has it.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); st.save(); return; }
      const t = e.target as Element;
      if (e.key !== ' ' || t.closest?.('button, input, select, textarea, [contenteditable], dialog')) return;
      e.preventDefault();
      pv.setPlaying(!st.playing.peek());
    };
    document.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      unreport();
      delete leaveGuard.isDirty;
      delete leaveGuard.discard;
      document.removeEventListener('keydown', onKey);
      pv.destroy();
      st.dispose();
    };
  }, []);
  return <StudioLayout {...ctx} />;
}
