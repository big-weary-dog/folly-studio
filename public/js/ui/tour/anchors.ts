// Finding what a step points at, following it on screen, and keeping the tour above modal dialogs. A control is
// named by `data-tour` (a space-separated list of names, by meaning, never by CSS class). The tour's root is a manual
// popover in the top layer; a popover shown after a modal dialog is inert (Chromium), so while one is open the root
// sits inside it, shown again over it.
import { signal } from '@preact/signals';

/** Bumped (at most every 80 ms) when the page's nodes or open state change, while a step watches. */
export const tick = signal(0);

export const byName = (name: string) => document.querySelector(`[data-tour~="${CSS.escape(name)}"]`);

/** Shown: laid out, not hidden, and not inside a closed popover or menu. */
export function visible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && el.checkVisibility({ visibilityProperty: true });
}

/** The last of `names` on screen, else null. */
export function pick(names: string[]) {
  for (let i = names.length - 1; i >= 0; i--) {
    const el = byName(names[i]);
    if (visible(el)) return el;
  }
  return null;
}

let timer = 0;
const bump = () => { if (!timer) timer = window.setTimeout(() => { timer = 0; tick.value++; }, 80); };
const WATCHED = ['open', 'hidden', 'class', 'data-tour', 'aria-expanded', 'aria-selected', 'aria-pressed'];

/** Watch the page for as long as the tour is open: nodes added and removed, open and shown state, field input. */
export function watchPage(root: HTMLElement) {
  const mo = new MutationObserver((list) => {
    if (list.some((m) => !root.contains(m.target))) bump();
    raise(root);
  });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: WATCHED });
  const onToggle = (e: Event) => { if ((e.target as Element) !== root) raise(root); bump(); };
  document.addEventListener('toggle', onToggle, true);
  document.addEventListener('input', bump, true);
  addEventListener('popstate', bump);
  return () => {
    mo.disconnect();
    document.removeEventListener('toggle', onToggle, true);
    document.removeEventListener('input', bump, true);
    removeEventListener('popstate', bump);
  };
}

let order = '';
/** Keep the root on top: inside the topmost open modal dialog, else in body, and last in the top layer. */
export function raise(root: HTMLElement) {
  const modal = [...document.querySelectorAll('dialog')].filter((d) => d.open && d.matches(':modal')).at(-1);
  const host = modal ?? document.body;
  const pops = [...document.querySelectorAll(':popover-open, dialog:modal')].filter((e) => e !== root);
  const key = `${pops.length}:${pops.at(-1)?.id ?? ''}:${host === document.body ? '' : 'dialog'}`;
  if (root.parentElement === host && key === order && root.matches(':popover-open')) return;
  order = key;
  const focus = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  if (root.matches(':popover-open')) root.hidePopover();
  if (root.parentElement !== host) host.append(root);
  root.showPopover();
  focus?.focus({ preventScroll: true });
}

export type Box = { x: number; y: number; w: number; h: number };
/** Call `on` with `el`'s box now and whenever it moves or resizes (scrolls anywhere, the window, its own size). */
export function follow(el: HTMLElement, on: (b: Box) => void) {
  const send = () => { const r = el.getBoundingClientRect(); on({ x: r.left, y: r.top, w: r.width, h: r.height }); };
  const ro = new ResizeObserver(send);
  ro.observe(el);
  addEventListener('scroll', send, true);
  addEventListener('resize', send);
  send();
  return () => { ro.disconnect(); removeEventListener('scroll', send, true); removeEventListener('resize', send); };
}
