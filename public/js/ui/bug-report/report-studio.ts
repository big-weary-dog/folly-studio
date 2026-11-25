// The Studio's part in bug reports (SPEC "Bug reports"): what it says of the moment, its pause, its picture; and the
// replay, /studio?report=<id> (admins): the captured draft in an unsaved editor, set as it was, paused.
import type { Look } from '../../../../shared/schemas/api.ts';
import { api } from '../../api.ts';
import type { ReportPage } from './bug-report.tsx';
import { type Captured, parseCaptured } from './captured.ts';
import { toast } from '../kit.tsx';
import type { Preview } from '../studio/preview.ts';
import type { Studio } from '../studio/store.ts';
import type { createTimeline } from '../timeline/state.ts';

type Timeline = ReturnType<typeof createTimeline>;

export function studioReport(st: Studio, pv: Preview, tl: Timeline) {
  let was = false;
  return {
    read() {
      const L = st.look.peek(), server = st.server.peek(), rig = st.data.rig;
      return {
        look: { id: L.id, title: L.title, owner: L.ownerName, shared: L.shared },
        draft: st.body.peek(), dirty: st.dirty.peek(), ready: st.ready.peek(),
        server: server && { updatedAt: server.updatedAt, reviewed: server.reviewed, bake: server.bake?.status },
        selection: { layer: st.selectedId.peek(), module: st.module.peek()?.id ?? null, picked: st.picked.peek(),
          muted: [...st.muted.peek()], solo: [...st.solo.peek()] },
        layout: { dock: st.dock.peek(), tab: st.tab.peek(), side: st.side.peek(), folded: st.folded.peek(),
          narrow: st.narrow.peek() },
        timeline: { sel: tl.sel.peek(), fit: tl.fit.peek(), zoomPps: tl.zoomPps.peek() },
        clock: { t: st.clock.t, playing: st.playing.peek(), speed: st.speed.peek(), baked: st.baked.peek() },
        preview: { view: pv.view.peek(), mode: pv.mode.peek(), tier: pv.tier.peek(), quality: pv.quality.peek(),
          venue: pv.venue.peek(), ghost: pv.ghost.peek(), dimmed: pv.dimmed.peek(), flashing: pv.flashing.peek(),
          stats: pv.stats.peek(), msg: pv.msg.peek() },
        heavy: Object.fromEntries(st.heavy.peek()), problem: st.problem.peek(),
        layers: L.layers.map((l) => ({ id: l.id, title: l.title, status: st.status.of(l.id),
          modules: l.modules.map((m) => ({ id: m.id, kind: m.kind, status: st.status.module(l.id, m) })) })),
        library: { patterns: st.data.library.length }, rig: rig && { name: rig.name, count: rig.count },
      };
    },
    freeze(on: boolean) {
      if (on) { was = st.playing.peek(); pv.setPlaying(false); pv.freeze(true); return; }
      pv.freeze(false);
      pv.setPlaying(was);
    },
    shot: () => pv.viewer?.snapshot() ?? null,
  } satisfies ReportPage;
}

/** A report's captured Studio: the draft as a new look to open, and how to set the editor as it was once open. */
export async function loadReport(id: string) {
  const { report } = await api.bugReport(id);
  const c = parseCaptured((report.sources as { studio?: unknown } | undefined)?.studio);
  if (!c) throw new Error('That report was not filed from the Studio.');
  const look = { ...c.draft, id: null, shared: false } as unknown as Look;
  return { look, apply: (st: Studio, pv: Preview, tl: Timeline) => apply(st, pv, tl, c, id) };
}

/** Sets what the report captured; what it did not (undefined) stays as it is. */
const set = <T>(sig: { value: T }, v: T | undefined) => { if (v !== undefined) sig.value = v; };

async function apply(st: Studio, pv: Preview, tl: Timeline, c: Captured, id: string) {
  st.server.value = null;
  const s = c.selection, lay = c.layout, clock = c.clock, p = c.preview;
  set(st.selectedId, s.layer);
  set(st.picked, s.picked);
  set(st.muted, s.muted);
  set(st.solo, s.solo);
  // as signals, not preferences: the admin's own layout is not changed
  set(st.dock, lay.dock);
  set(st.tab, lay.tab);
  set(st.side, lay.side);
  set(st.folded, lay.folded);
  set(tl.sel, c.timeline.sel);
  set(tl.fit, c.timeline.fit);
  set(tl.zoomPps, c.timeline.zoomPps);
  st.speed.value = clock.speed;
  pv.setPlaying(false);
  pv.seek(clock.t);
  const v = pv.viewer;
  if (v) {
    if (p.quality) { pv.quality.value = p.quality; v.setQuality(p.quality); }
    if (p.mode) pv.mode.value = (await v.setMode(p.mode)) || 'points';
    if (p.view && (p.view === 'fit' || pv.views.peek().includes(p.view))) v.setView(p.view, { animate: false });
    if (p.venue !== undefined) v.showVenue(p.venue);
  }
  toast(`Report ${id} as captured, at ${clock.t.toFixed(2)} s${clock.baked ? ' (it was playing baked frames)'
    : ''}. Nothing is saved unless you save it.`, { timeout: 8000 });
}
