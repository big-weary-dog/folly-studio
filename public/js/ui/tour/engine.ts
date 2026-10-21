// The tutorial's engine (SPEC-tutorial): which path and step is open, when a step is done, and the progress kept on
// the account (PUT /api/me/tour, a copy in localStorage). It mounts the overlay in a root of its own and reads the
// Studio only through tourView; it moves between pages only through navigate(), so unsaved edits are asked about.
import '../../../css/tour.css';

import { computed, effect, signal } from '@preact/signals';
import { h, render } from 'preact';

import { api } from '../../api.ts';
import type { Tour } from '../../../../shared/schemas/tour.ts';
import { reducedMotion, toast } from '../kit.tsx';
import { loadLibrary } from '../model.ts';
import { navigate, user } from '../session.ts';
import { localTour, tourKey, tourView } from '../tour-view.ts';
import { byName, tick, watchPage } from './anchors.ts';
import { Overlay } from './overlay.tsx';
import { PATHS } from './paths/index.ts';
import type { Ctx, Path } from './types.ts';

export type Open = { mode: 'welcome' } | { mode: 'menu'; finished?: string }
  | { mode: 'step'; path: Path; i: number; base?: { v: unknown }; done: boolean };
export const open = signal<Open | null>(null);
/** The library's titles by name, for the steps' text; empty until loaded. */
export const titles = signal<Record<string, string>>({});
export const progress = signal<Tour>(user.peek()?.tour ?? localTour(user.peek()) ?? { seen: true, done: [] });

export const ctx = computed((): Ctx => {
  void tick.value;
  return { v: tourView.value, page: location.pathname, el: byName };
});
export const step = computed(() => { const o = open.value; return o?.mode === 'step' ? o.path.steps[o.i] : null; });
/** Whether the open step is on its page (else the card offers to go there). */
export const here = computed(() => {
  const s = step.value, c = ctx.value;
  return !s?.page || (c.page.startsWith(s.page) && (s.page !== '/studio' || !!c.v?.ready.value));
});

function save(t: Tour) {
  progress.value = t;
  const u = user.peek();
  if (!u) return;
  try { localStorage.setItem(tourKey(u), JSON.stringify(t)); } catch { /* storage off: the account keeps it */ }
  user.value = { ...u, tour: t };
  api.saveTour(t).catch(() => {});   // offline: the copy here shows it, and the next save sends it
}

let root: HTMLElement | null = null, unwatch = () => {}, stop = () => {}, later = 0;
function mount() {
  if (root) return;
  root = Object.assign(document.createElement('div'), { id: 'tour', className: 'tour-root' });
  root.setAttribute('popover', 'manual');
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.append(root);
  render(h(Overlay, null), root);
  root.showPopover();
  unwatch = watchPage(root);
  stop = effect(check);
  void loadLibrary().then((lib) => { titles.value = Object.fromEntries(lib.map((e) => [e.name, e.title || e.name])); })
    .catch(() => {});
}
function unmount() {
  clearTimeout(later);
  stop();
  unwatch();
  if (root) { render(null, root); root.remove(); root = null; }
  open.value = null;
}

/** Each change the step reads: take its baseline once on its page, then mark it done (and move on, unless it waits
 * for Next). */
function check() {
  const o = open.value;
  if (o?.mode !== 'step' || o.done || !here.value) return;
  const s = o.path.steps[o.i], c = ctx.value;
  if (!o.base) { open.value = { ...o, base: { v: s.begin?.(c) } }; return; }
  if (!s.done(c, o.base.v)) return;
  open.value = { ...o, done: true };
  if (!s.next) later = window.setTimeout(next, reducedMotion() ? 0 : 600);
}

export function welcome() { mount(); open.value = { mode: 'welcome' }; }
export function menu(finished?: string) { mount(); open.value = { mode: 'menu', finished }; }

/** Start a path at step `i` (where it was left, when resumed): its practice look first. */
export function start(path: Path, i = 0) {
  mount();
  clearTimeout(later);
  save({ ...progress.peek(), seen: true, at: { path: path.id, step: path.steps[Math.min(i, path.steps.length - 1)].id } });
  open.value = { mode: 'step', path, i: Math.min(i, path.steps.length - 1), done: false };
  if (path.start.includes('?')) void navigate(path.start);
}

export function next() {
  clearTimeout(later);
  const o = open.value;
  if (o?.mode !== 'step') return;
  if (o.i + 1 < o.path.steps.length) {
    open.value = { mode: 'step', path: o.path, i: o.i + 1, done: false };
    save({ ...progress.peek(), at: { path: o.path.id, step: o.path.steps[o.i + 1].id } });
    return;
  }
  const { at: _, ...rest } = progress.peek();
  save({ ...rest, done: [...new Set([...rest.done, o.path.id])] });
  menu(o.path.title);
}

/** Close the tutorial: the welcome counts as seen, a path keeps the step it stopped at. */
export function close() {
  const o = open.value;
  if (o?.mode === 'welcome' || !progress.peek().seen) save({ ...progress.peek(), seen: true });
  if (o?.mode === 'step') {
    save({ ...progress.peek(), at: { path: o.path.id, step: o.path.steps[o.i].id } });
    toast('Tutorial closed. Resume it from your name › Tutorials.');
  } else if (o?.mode === 'welcome') toast('The tutorial is in your name › Tutorials, whenever you want it.');
  unmount();
}

/** Where a path was left: its step's index, or 0. */
export function resumeAt(path: Path) {
  const at = progress.value.at;
  return at?.path === path.id ? Math.max(0, path.steps.findIndex((s) => s.id === at.step)) : 0;
}
export { PATHS };
