// What the tutorial may see of the Studio (SPEC-tutorial): computeds over its store and preview, set while the Studio
// is open. A computed cannot be written, so the tour reads the Studio and never changes it.
import { computed, type ReadonlySignal, signal } from '@preact/signals';

import type { Tour } from '../../../shared/schemas/tour.ts';
import type { User } from '../../../shared/schemas/api.ts';
import { toast } from './kit.tsx';
import type { Preview } from './preview.ts';
import type { Studio } from './studio-store.ts';

export type TourModule = { id: string; title: string; kind: string; ref?: string; enabled: boolean };
export type TourLayer = { id: string; title: string; modules: TourModule[]; muted: boolean; solo: boolean;
  level: number; blend: string; groups?: string[]; soften: number; clips: number };
export type TourView = {
  ready: ReadonlySignal<boolean>; layers: ReadonlySignal<TourLayer[]>; selected: ReadonlySignal<TourLayer | null>;
  module: ReadonlySignal<TourModule | null>; params: ReadonlySignal<Readonly<Record<string, unknown>>>;
  playing: ReadonlySignal<boolean>; view: ReadonlySignal<string | null>; dock: ReadonlySignal<string>;
  dirty: ReadonlySignal<boolean>; lookId: ReadonlySignal<string | null>; bpm: ReadonlySignal<number | null>;
  palette: ReadonlySignal<string | null>; automation: ReadonlySignal<Readonly<Record<string, number>>>;
  historyAt: ReadonlySignal<number>; macros: ReadonlySignal<string[]>;
  /** The groups carrying a rig tag, then those under them; a param's label in a module made from library `ref`. */
  tagged: (tag: string) => string[]; label: (ref: string, key: string) => string | null;
};

export const tourView = signal<TourView | null>(null);
/** A layer's `data-tour` name part: its title in lower case, a dash for each run of anything else. */
export const tourName = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The tutorial is for a laptop's screen or wider: on a phone it neither opens nor is offered. */
export const tourFits = () => matchMedia('(min-width: 900px)').matches;
/** Where this browser keeps a copy of an account's progress, shown when the account's save failed. */
export const tourKey = (u: User) => `studio.tour.${u.id}`;
export function localTour(u: User | null): Tour | null {
  try { return u && JSON.parse(localStorage.getItem(tourKey(u)) || 'null'); } catch { return null; }
}
/** Open the tutorial (loaded on first use): the welcome, or Tutorials, its list of paths. */
export function openTour(what: 'welcome' | 'menu') {
  if (!tourFits()) { toast('The tutorial needs a wider screen: open the Studio on a laptop.'); return; }
  void import('./tour/engine.ts').then((m) => (what === 'welcome' ? m.welcome() : m.menu()))
    .catch((err) => toast(`Could not load the tutorial: ${(err as Error).message}`, { kind: 'error' }));
}
/** Set once this browser has shown the welcome to anyone: a second account here is the same person, mostly. */
export const WELCOMED = 'studio.tour.welcomed';
const welcomed = () => { try { return !!localStorage.getItem(WELCOMED); } catch { return false; } };
/** First visit on a wide screen, by an account that has not seen it: the welcome opens by itself. */
export function welcomeOnce(u: User | null) {
  if (u && !u.tour && !localTour(u)?.seen && !welcomed() && tourFits()) openTour('welcome');
}

/** The Studio shows itself to the tour while open: the returned function hides it again. */
export function showToTour(st: Studio, pv: Preview) {
  const layers = computed(() => st.look.value.layers.map((l): TourLayer => ({ id: l.id, title: l.title,
    modules: l.modules.map((m) => ({ id: m.id, title: m.title, kind: m.kind, ref: m.ref,
      enabled: m.enabled !== false })),
    muted: st.muted.value.has(l.id), solo: st.solo.value.has(l.id), level: l.level, blend: l.blend, groups: l.groups,
    soften: l.soften?.radius ?? 0, clips: l.clips?.length ?? 0 })));
  const selected = computed(() => layers.value.find((l) => l.id === st.selectedId.value) ?? null);
  tourView.value = {
    ready: computed(() => st.ready.value), layers, selected,
    module: computed(() => selected.value?.modules.find((m) => m.id === st.module.value?.id) ?? null),
    params: computed(() => ({ ...st.module.value?.params })),
    playing: computed(() => st.playing.value), view: computed(() => pv.view.value), dock: computed(() => st.dock.value),
    dirty: computed(() => st.dirty.value), lookId: computed(() => st.look.value.id),
    bpm: computed(() => st.look.value.bpm), palette: computed(() => st.look.value.globals?.palette?.name ?? null),
    automation: computed(() => Object.fromEntries(Object.entries(st.look.value.automation ?? {})
      .map(([k, pts]) => [k, pts?.length ?? 0]))),
    historyAt: computed(() => st.history.at.value),
    macros: computed(() => Object.keys(st.look.value.globals?.macros ?? {})),
    tagged: (tag) => {
      const all = st.data.rig?.groups ?? [], top = all.filter((g) => g.tags?.includes(tag)).map((g) => g.id);
      const under = all.filter((g) => !top.includes(g.id)
        && st.data.index?.ancestors(g.id).some((a) => top.includes(a)));
      return [...top, ...under.map((g) => g.id)];
    },
    label: (ref, key) => {
      for (const l of st.look.peek().layers) {
        const m = l.modules.find((x) => x.ref === ref);
        const p = m && st.status.params(l.id, m).schema?.[key];
        if (p && typeof p === 'object' && 'label' in p && typeof p.label === 'string') return p.label;
      }
      return null;
    },
  };
  return () => { tourView.value = null; };
}
