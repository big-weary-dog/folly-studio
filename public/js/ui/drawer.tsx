// A drawer: a panel docked the Studio's full height between the 3D view and the side column, so the view shrinks
// beside it and stays live (∿'s Modulate; a layer's Groups). One shows at a time: a drawer opened from inside
// another stacks over it, and closing it shows the one under it again. Escape or × closes the top one. On a phone
// it is a sheet over the foot of the screen. The Studio places `DrawerSlot` once; CSS opens its column when a drawer
// is in it.
import '../../css/drawer.css';

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { createContext, render } from 'preact';
import { useContext, useEffect, useId, useLayoutEffect, useState } from 'preact/hooks';

import { cx } from './kit.tsx';

/** The open drawers, outermost first; the last is the one shown. */
const stack = signal<string[]>([]);
const Parent = createContext('');
const SLOT = 'drawer-slot';

export type DrawerHandle = { id: string; open: boolean; show: () => void; hide: () => void; toggle: () => void };

/** A drawer's state, for its opener and its `Drawer`: opened inside another drawer, it stacks over that one;
 * anywhere else, it replaces whatever was open. */
export function useDrawer(): DrawerHandle {
  const id = useId(), parent = useContext(Parent), s = stack.value, open = s.includes(id);
  const show = () => {
    const at = stack.peek().indexOf(parent);
    stack.value = [...(parent && at >= 0 ? stack.peek().slice(0, at + 1) : []), id];
  };
  const hide = () => { const at = stack.peek().indexOf(id); if (at >= 0) stack.value = stack.peek().slice(0, at); };
  useEffect(() => hide, []);   // unmounted (another layer selected): closed, with any stacked over it
  return { id, open, show, hide, toggle: () => (open ? hide() : show()) };
}

/** The Studio's place for drawers: a grid column of its own, empty (no width) until one opens. */
export function DrawerSlot() {
  return <div class={SLOT} />;
}

/** The drawer itself, in the Studio's slot while `d` is open: its title, `actions` beside it (a Revert), ×, and
 * `children` below, scrolling only if the window is too short for them. Its own render root in the slot, not a
 * compat portal: `preact/compat` would turn every text field's onChange into onInput. */
export function Drawer({ d, title, actions, class: cls, children }: { d: DrawerHandle; title: ComponentChildren;
  actions?: ComponentChildren; class?: string; children: ComponentChildren }) {
  const [el] = useState(() => Object.assign(document.createElement('section'), { tabIndex: -1 }));
  const top = d.open && stack.value.at(-1) === d.id;
  useLayoutEffect(() => {
    const slot = document.querySelector(`.${SLOT}`);
    if (!d.open || !slot) return undefined;
    const from = document.activeElement;
    slot.append(el);
    el.focus({ preventScroll: true });
    return () => {   // focus goes back to its opener if it was in the drawer, not if it moved on
      const at = document.activeElement, lost = !at || at === document.body || el.contains(at);
      render(null, el);
      el.remove();
      if (lost && from instanceof HTMLElement && from.isConnected) from.focus();
    };
  }, [d.open]);
  useLayoutEffect(() => {
    if (!el.isConnected) return;
    el.className = cx('drawer', cls);
    Object.entries({ role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': `${d.id}-t`, 'data-drawer': d.id })
      .forEach(([k, v]) => el.setAttribute(k, v));
    render(<Parent.Provider value={d.id}>
      <div class="drawer-head"><h2 class="drawer-title" id={`${d.id}-t`}>{title}</h2>{actions}
        <button type="button" class="icon-btn drawer-close" aria-label="Close" onClick={d.hide}>×</button></div>
      <div class="drawer-body">{children}</div></Parent.Provider>, el);
  });
  useEffect(() => {
    if (!top) return undefined;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); d.hide(); }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [top]);
  return null;
}
