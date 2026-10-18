// The timeline's state, shared by its view (timeline.tsx) and its tools (timeline-tools.tsx): the zoom, the
// selected clip, snapping, a clip being dragged, and the edits (SPEC "Timeline"; the maths in timeline-model.ts).
import { computed, signal } from '@preact/signals';

import type { Clip, Layer, Look } from '../types.ts';
import { pref, randomId, toast } from './kit.tsx';
import { normaliseLayers } from './model.ts';
import type { Preview } from './preview.ts';
import type { Studio } from './studio-store.ts';
import {
  addClip, cleanDuration, clock, contentEnd, DEFAULT_DURATION, importLook, removeClip, snapStep,
} from './timeline-model.ts';

export const NAMES_W = 112;           // the layer-name column on a wide screen
const MAX_PPS = 200;                  // pixels a second, fully zoomed in
const MAX_WIDTH = 120000;             // and never wider than this

export function createTimeline(st: Studio, pv: Preview) {
  const sel = signal<{ id: string; index: number } | null>(null);
  const snap = signal(pref('studio.snap') || 'grid');
  const fit = signal(true), zoomPps = signal(1), viewW = signal(0);
  /** A clip being dragged, shown before the look catches up (it does every LIVE_MS, and on release). */
  const drag = signal<{ id: string; clips: Clip[] } | null>(null);
  const duration = computed(() => st.look.value.duration || DEFAULT_DURATION);
  const namesW = computed(() => (st.narrow.value ? 0 : NAMES_W));
  /** The time the view spans: the look, and any clip past its end. */
  const span = computed(() => Math.max(1, duration.value,
    contentEnd(st.look.value.layers.filter((l) => l.clips?.length), 0)));
  const pps = computed(() => {
    const s = span.value, fitPps = viewW.value / s, want = fit.value ? fitPps : Math.max(zoomPps.value, fitPps);
    return Math.min(want, Math.max(fitPps, Math.min(MAX_PPS, MAX_WIDTH / s))) || 1;
  });
  const contentW = computed(() => Math.max(viewW.value, Math.ceil(span.value * pps.value)));
  const clipsOf = (l: Layer) => (drag.value?.id === l.id ? drag.value.clips : l.clips || []);
  /** The selected clip, while its layer is the selected one. */
  const selected = computed(() => {
    const s = sel.value, layer = st.selected.value;
    const clip = s && layer?.id === s.id ? clipsOf(layer)[s.index] : undefined;
    return clip && layer && s ? { layer, index: s.index, clip } : null;
  });
  let scroller: HTMLElement | null = null;      // the view's scrolling element, for zoom and focus

  const tl = {
    sel, snap, fit, zoomPps, viewW, drag, duration, namesW, span, pps, contentW, selected, clipsOf,
    setScroller(el: HTMLElement | null) { scroller = el; },
    /** The snap step (s; 0: none). */
    step: () => snapStep(snap.peek(), st.look.peek().bpm),
    /** How far an edit may push clip c: the look's end, or c's if past it. */
    limit: (c?: Clip) => Math.max(duration.peek(), c ? c.end : 0),
    layer: (id: string) => st.layerById(id),

    /** Zoom by `factor`, keeping the time under `anchor` (px into the lanes) in place. */
    zoom(factor: number, anchor = viewW.peek() / 2) {
      if (st.narrow.peek() || !scroller) return;
      const el = scroller, t = (el.scrollLeft + anchor) / pps.peek(), fitPps = viewW.peek() / span.peek();
      zoomPps.value = Math.max(fitPps, Math.min(MAX_PPS, pps.peek() * factor));
      fit.value = zoomPps.value <= fitPps * 1.001;
      setTimeout(() => { el.scrollLeft = Math.max(0, t * pps.peek() - anchor); }, 0);   // once it is that wide
    },
    zoomToFit() { fit.value = true; },

    /** Select clip `index` of layer `id` (null: just the layer), and its layer. */
    selectClip(id: string, index: number | null, { focus = false } = {}) {
      sel.value = index === null ? null : { id, index };
      if (st.selectedId.peek() !== id) st.select(id);
      if (focus && index !== null) tl.focusClip(id, index);
    },
    focusClip(id: string, index: number) {
      setTimeout(() => (scroller?.querySelector(`.tl-row[data-id="${CSS.escape(id)}"] .tl-clip[data-i="${index}"]`) as
        HTMLElement | null)?.focus({ preventScroll: true }), 0);
    },

    /** New clips for a layer (none: always on), optionally selecting one. */
    setClips(id: string, clips: Clip[], select?: number | null) {
      if (select !== undefined) sel.value = select === null ? null : { id, index: select };
      st.editLayer(id, () => ({ clips: clips.length ? clips : undefined }));
    },

    /** A clip a bar (or 4 s) long on `layer` at time t, selected. */
    addClipAt(layer: Layer | null, t: number) {
      if (!layer) return;
      const bpm = st.look.peek().bpm, d = duration.peek();
      const made = addClip(layer.clips, t, bpm ? 240 / bpm : 4, tl.step(), d);
      if (!made) {
        toast(t >= d ? 'That is after the end of the look: make it longer first.' : 'No room there.', { kind: 'warn' });
        return;
      }
      tl.setClips(layer.id, made.clips, made.index);
      tl.focusClip(layer.id, made.index);
    },

    removeSelected() {
      const s = selected.peek();
      if (!s) return;
      const before = s.layer.clips || [], after = removeClip(before, s.index);
      tl.setClips(s.layer.id, after, null);
      scroller?.focus({ preventScroll: true });
      const text = after.length ? 'Clip removed.' : `No clips left: “${s.layer.title}” plays throughout again.`;
      toast(text, { action: { label: 'Undo', onClick: () => tl.setClips(s.layer.id, before, s.index) } });
    },

    setDuration(d: number) {
      st.edit(() => ({ duration: cleanDuration(d) }));
      st.clock.t %= duration.peek();
    },
    setBpm(bpm: number | null) {
      st.edit(() => ({ bpm }));
      if (!bpm && snap.peek() === 'beat') tl.setSnap('grid');
    },
    setSnap(mode: string) { snap.value = mode; pref('studio.snap', mode); },

    /** Play another look after this one → an error, or ''. */
    importLook(other: Look) {
      const L = st.look.peek(), d = duration.peek();
      const r = importLook(L.layers, d, { ...other, layers: normaliseLayers(other.layers, st.data.rig) },
        () => randomId('l'));
      if ('error' in r) return r.error as string;
      const before = { layers: L.layers, duration: L.duration, selected: st.selectedId.peek() };
      const apply = (layers: Layer[], duration: number, selectedId: string | null) => {
        st.edit(() => ({ layers, duration }));
        fit.value = true;
        st.select(selectedId);
      };
      apply(r.layers, r.duration, r.layers[r.layers.length - 1].id);
      const n = r.layers.length - before.layers.length;
      const ended = r.ended ? ` Layers that played throughout now end at ${clock(r.start)}.` : '';
      toast(`Added ${n} layer${n > 1 ? 's' : ''} from “${other.title || 'a look'}”, ${clock(r.start)}–${clock(r.end)}.`
        + ended, { timeout: 8000,
        action: { label: 'Undo', onClick: () => apply(before.layers, before.duration, before.selected) } });
      return '';
    },
    /** The time now, for "add a clip at the playhead". */
    now: () => st.clock.t,
    seek: (t: number) => pv.seek(Math.max(0, Math.min(duration.peek(), t))),
  };
  return tl;
}
export type TimelineState = ReturnType<typeof createTimeline>;
