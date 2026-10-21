// What every view shares: toasts, modal dialogs, labelled fields and switches, and small helpers. Markup is JSX
// (Preact builds the nodes), never HTML strings.
import { signal, type Signal } from '@preact/signals';
import { type ComponentChildren, render } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { reloadIfIdle } from './updates.ts';

/** Class names, skipping the falsy ones. */
export const cx = (...names: unknown[]) => names.filter(Boolean).join(' ');
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A remembered preference: pref(key) reads it, pref(key, value) stores it. */
export function pref(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* private mode etc. */ }
  return null;
}

export function randomId(prefix = 'l') {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return prefix + a[0].toString(36) + a[1].toString(36).slice(0, 3);
}

// Toasts: a list of messages, each closing itself after `timeout` ms (0: never) unless the pointer rests on it.
type ToastKind = 'info' | 'ok' | 'warn' | 'error';
interface ToastOptions { kind?: ToastKind; timeout?: number; action?: { label: string; onClick: () => void } }
interface ToastItem extends ToastOptions {
  id: number; message: string; leaving: Signal<boolean>; close(): void; hold(): void; release(): void;
}
const toasts = signal<ToastItem[]>([]);
let toastId = 0;
/** The last 50 toasts shown, oldest first, for bug reports. */
export const toastHistory: { at: string; kind: ToastKind; message: string }[] = [];

/** Shows a message; returns its close(). */
export function toast(message: string, { kind = 'info', timeout = 4200, action }: ToastOptions = {}) {
  let timer = timeout ? setTimeout(close, timeout) : 0;
  const t: ToastItem = { id: ++toastId, message, kind, action, leaving: signal(false), close,
    hold() { clearTimeout(timer); timer = 0; },
    release() { if (timeout && !timer) timer = setTimeout(close, 1800); } };
  function close() {
    clearTimeout(timer);
    t.leaving.value = true;
    setTimeout(() => { toasts.value = toasts.value.filter((x) => x !== t); }, reducedMotion() ? 0 : 180);
  }
  toasts.value = [...toasts.value, t];
  toastHistory.push({ at: new Date().toISOString(), kind, message });
  if (toastHistory.length > 50) toastHistory.shift();
  return close;
}

let loadToast = false;
/** A new build (SPEC "Updates"), or a lazy part of the app failed to load (most likely a deploy replaced its file):
 *  the page reloads onto it when nothing is unsaved, else says so, one toast however many parts fail. */
export async function loadFailed(err?: unknown) {
  if (err) console.error(err);
  if (await reloadIfIdle().catch(() => false) || loadToast) return;
  loadToast = true;
  toast('Folly Studio was updated. Reload to carry on.',
    { kind: 'error', timeout: 0, action: { label: 'Reload', onClick: () => location.reload() } });
}

export const Toasts = () => (
  <div id="toasts" class="toasts" aria-live="polite">
    {toasts.value.map((t) => (
      <div key={t.id} class={cx('toast', `toast-${t.kind}`, t.leaving.value && 'leaving')}
        role={t.kind === 'error' ? 'alert' : 'status'} onPointerEnter={t.hold} onPointerLeave={t.release}>
        <span class="toast-msg">{t.message}</span>
        {t.action && <button class="btn small ghost" type="button"
          onClick={() => { t.action?.onClick(); t.close(); }}>{t.action.label}</button>}
        <button class="toast-close" type="button" aria-label="Dismiss" onClick={t.close}>×</button>
      </div>))}
  </div>);

interface DialogOptions<T> {
  title: string; className?: string; dismissable?: boolean; onClose?: (result: T | undefined) => void;
  /** The dialog's body, drawn as a component (it may use hooks); close(value) resolves the dialog. */
  body: (close: (value?: T) => void) => ComponentChildren;
}

/** A modal <dialog>; resolves with what close() was given (undefined when dismissed). */
export function openDialog<T>({ title, className, dismissable = true, onClose, body }: DialogOptions<T>) {
  return new Promise<T | undefined>((resolve) => {
    const host = document.body.appendChild(document.createElement('div'));
    let result: T | undefined, dlg: HTMLDialogElement | null = null;
    const close = (value?: T) => { result = value; if (dlg?.open) dlg.close(); };
    const closed = () => { render(null, host); host.remove(); onClose?.(result); resolve(result); };
    const Content = () => <>{body(close)}</>;
    function Dialog() {
      // Not useId: this is a render root of its own, whose ids would repeat the app's.
      const ref = useRef<HTMLDialogElement>(null), [titleId] = useState(() => randomId('dlg-'));
      useLayoutEffect(() => { dlg = ref.current; dlg?.showModal(); }, []);
      return (
        <dialog ref={ref} class={cx('dialog', className)} aria-labelledby={titleId} onClose={closed}
          onCancel={(e) => { if (!dismissable) e.preventDefault(); }}>
          <header class="dialog-head">
            <h2 id={titleId}>{title}</h2>
            {dismissable && <button class="icon-btn" type="button" aria-label="Close" onClick={() => close()}>
              ×</button>}
          </header>
          <div class="dialog-body"><Content /></div>
        </dialog>);
    }
    render(<Dialog />, host);
  });
}

export function confirmDialog(message: string, { title = 'Are you sure?', ok = 'OK', danger = false } = {}) {
  return openDialog<boolean>({ title, body: (close) => <>
    <p class="dialog-text">{message}</p>
    <div class="dialog-actions">
      <button class="btn ghost" type="button" onClick={() => close(false)}>Cancel</button>
      <button class={cx('btn', danger ? 'danger' : 'primary')} type="button" autofocus onClick={() => close(true)}>
        {ok}</button>
    </div>
  </> }).then(Boolean);
}

/** Places popover `pop` (as it opens) beside the button that opens it, `width` px wide (CSS sets it; nothing is
 * measured); a phone's is a sheet (CSS). In the side panel: to its left, over the 3D view, level with the button, so
 * it never covers the panel. Elsewhere: below the button, or above it when the room is there. */
export function placePopover(e: { newState: string; currentTarget: HTMLElement }, pop: string, width: number,
  narrow: boolean) {
  const s = e.currentTarget.style;
  if (e.newState !== 'open' || narrow) { s.top = s.left = s.bottom = s.maxHeight = ''; return; }
  const btn = document.querySelector(`[popovertarget="${pop}"]`) as HTMLElement, r = btn.getBoundingClientRect();
  const side = btn.closest('.side')?.getBoundingClientRect();
  if (side && side.left >= width + 16) {
    const top = Math.max(8, Math.min(r.top, innerHeight - 420));
    Object.assign(s, { left: `${side.left - width - 8}px`, top: `${top}px`, bottom: '',
      maxHeight: `${innerHeight - top - 8}px` });
    return;
  }
  const below = innerHeight - r.bottom, up = below < 300 && r.top > below;
  s.left = `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`;
  s.top = up ? '' : `${r.bottom + 4}px`;
  s.bottom = up ? `${innerHeight - r.top + 4}px` : '';
  s.maxHeight = `${(up ? r.top : below) - 12}px`;
}

/** A `.field`, one row: its label, then the control (given the label's id), or a read-only value. A label too long
 * for the label column takes its own line; `stack` always does, for what one line cannot hold (multi-line text). */
export function Field({ label, children, hint, stack, class: cls, title, tour }: { label: ComponentChildren;
  children: ComponentChildren | ((id: string) => ComponentChildren); hint?: ComponentChildren; stack?: boolean;
  class?: string; title?: string; tour?: string }) {
  const id = useId(), control = typeof children === 'function';
  return (
    <div class={cx('field', stack && 'stack', cls)} title={title} data-tour={tour}>
      {control ? <label for={id}>{label}</label> : <span>{label}</span>}
      <div class="field-control">{control ? children(id) : children}</div>{hint}</div>);
}

type Range = { min: number; max: number; step: number };
/** The decimals a step shows (0.05 → 2, at most 4). */
export function decimals(step: number) {
  const [m, e] = String(step).split('e-');
  return Math.min(4, e ? Number(e) : (m.split('.')[1] || '').length);
}
/** The decimals v needs beside its step's (0.003 at step 0.01 → 3, at most 6), so a fine value shows as typed. */
export function places(v: number, step: number) {
  let d = decimals(step);
  while (d < 6 && Math.abs(Number(v.toFixed(d)) - v) > 1e-9) d++;
  return d;
}
/** v on the step's grid from min, held to min..max. */
export const snap = (v: number, { min, max, step }: Range) =>
  Math.min(max, Math.max(min, Number((min + Math.round((v - min) / step) * step).toPrecision(12))));
/** v as typed, held to min..max; a whole step (a count) keeps it whole. */
export const exact = (v: number, { min, max, step }: Range) =>
  Math.min(max, Math.max(min, Number.isInteger(step) ? Math.round(v) : Number(v.toPrecision(12))));
/** From v, a drag of dx px across a field w px wide: its width spans the range on the step's grid (`fine`: a tenth
 * of that, on a grid a tenth of the step from v, so it reaches between the steps). */
export function scrubTo(v: number, dx: number, w: number, r: Range, fine = false) {
  const to = v + (dx / Math.max(1, w)) * (r.max - r.min) * (fine ? 0.1 : 1);
  return fine ? exact(v + Math.round((to - v) / (r.step / 10)) * (r.step / 10), r) : snap(to, r);
}

/** A number as one field, its glass filled to where the value sits in min..max. Drag across it or its label to
 * scrub (Shift: 10× finer, between the steps); click or tap to type any value in range; ↑/↓ (Shift: ×10), and the
 * wheel while focused, step it. */
export function Scrub({ id, label, value, unit = '', disabled, set, ...r }: Range & { id?: string; label?: string;
  value: number; unit?: string; disabled?: boolean; set: (v: number) => void }) {
  const ref = useRef<HTMLInputElement>(null), now = useRef({ value, set, r });
  const text = (v: number) => v.toFixed(places(v, r.step)) + unit;
  now.current = { value, set, r };
  const put = (v: number, el = ref.current!) => {   // the box at once; the value when it moves
    el.value = text(v);
    if (v !== now.current.value) now.current.set(v);
  };
  const num = (el: HTMLInputElement) => { const v = parseFloat(el.value); return Number.isFinite(v) ? v : value; };
  const step = (el: HTMLInputElement, n: number) => put(snap(num(el) + n * r.step, r), el);
  useEffect(() => {   // drags on the field and on its label, by pointer capture; a tap types
    const el = ref.current!, on: HTMLElement[] = [el, ...el.labels || []], eat = (c: Event) => c.preventDefault();
    function down(e: PointerEvent) {
      if (el.disabled || document.activeElement === el || e.button) return;
      e.preventDefault();
      const t = e.currentTarget as HTMLElement, x0 = e.clientX, v0 = now.current.value, drag = new AbortController();
      let moved = false;
      t.setPointerCapture(e.pointerId);
      t.addEventListener('pointermove', (m) => {
        moved ||= Math.abs(m.clientX - x0) > 3;
        if (moved) put(scrubTo(v0, m.clientX - x0, el.clientWidth, now.current.r, m.shiftKey));
      }, { signal: drag.signal });
      const up = (u: PointerEvent) => {
        drag.abort();
        if (moved) t.addEventListener('click', eat, { once: true });   // a drag on the label is not a click on it
        else if (u.type === 'pointerup') { el.focus(); el.select(); }
        setTimeout(() => t.removeEventListener('click', eat));
      };
      for (const k of ['pointerup', 'pointercancel'] as const) t.addEventListener(k, up, { signal: drag.signal });
    }
    for (const t of on) t.addEventListener('pointerdown', down);
    return () => { for (const t of on) t.removeEventListener('pointerdown', down); };
  }, []);
  // While it has focus, what is typed stays; put() writes the box whenever the value moves.
  return <input type="text" id={id} ref={ref} class="scrub" role="spinbutton" aria-label={label} autocomplete="off"
    value={document.activeElement === ref.current ? undefined : text(value)} disabled={disabled}
    inputMode={r.min < 0 ? 'text' : 'decimal'} aria-valuemin={r.min} aria-valuemax={r.max} aria-valuenow={value}
    aria-valuetext={text(value)} style={{ '--fill': ((exact(value, r) - r.min) / (r.max - r.min || 1)).toFixed(3) }}
    onChange={(e) => put(exact(num(e.currentTarget), r), e.currentTarget)}
    onKeyDown={(e) => {
      const n = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
      if (n) { e.preventDefault(); step(e.currentTarget, e.shiftKey ? n * 10 : n); }
      else if (e.key === 'Escape') { e.currentTarget.value = text(value); e.currentTarget.blur(); }
    }}
    onWheel={(e) => {
      const d = e.deltaY || e.deltaX;
      if (d && e.currentTarget === document.activeElement) { e.preventDefault(); step(e.currentTarget, -Math.sign(d)); }
    }} />;
}

/** A labelled switch (a checkbox) showing `checked`, which only the caller's state changes. */
export const Switch = ({ label, class: cls, checked, disabled, title, onChange }: { label: string; class: string;
  checked: boolean; disabled?: boolean; title?: string; onChange: (on: boolean) => void }) =>
  <Field label={label} class={cx('toggle', cls)} title={title}>{(id) => <input type="checkbox" class="switch" id={id}
    checked={checked} disabled={disabled}
    onChange={(e) => { const on = e.currentTarget.checked; e.currentTarget.checked = checked; onChange(on); }} />}
  </Field>;

/** A lazy part's loader: one that fails says so (loadFailed) and never settles, so nothing waits on it half-done. */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  return () => load().catch((err) => { void loadFailed(err); return new Promise<T>(() => {}); });
}

/** A module loaded on first use, once `when` holds (null until it has loaded). */
export function useLazy<T>(load: () => Promise<T>, when = true): T | null {
  const [mod, setMod] = useState<T | null>(null);
  useEffect(() => { if (when && !mod) lazy(load)().then((m) => setMod(() => m)); }, [when]);
  return mod;
}

export function timeAgo(when?: string | number) {
  const t = typeof when === 'number' ? when : Date.parse(when ?? '');
  if (!Number.isFinite(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const d = Math.round(hrs / 24);
  if (d < 14) return `${d} d ago`;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function slugify(s: string, fallback = 'look') {
  const slug = String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
    .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);
  return slug || fallback;
}

export function download(data: BlobPart, filename: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const humanize = (key: string) => String(key).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/^./, (c) => c.toUpperCase());

/** A card's stained glass: a gradient from a string. */
const JEWELS = ['#e5486b', '#5b8cff', '#f2b148', '#39c98f', '#a77bff', '#ff7a45', '#36b7d6'];
export function jewelGradient(seed: string) {
  let x = 2166136261;
  for (const ch of String(seed)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
  const [a, b, c] = [0, 1, 2].map((n) => JEWELS[(x >>> (n * 3)) % JEWELS.length]);
  const ang = (x >>> 8) % 360;
  return `radial-gradient(circle at 50% 38%, ${a}cc 0 10%, transparent 34%),` +
    ` conic-gradient(from ${ang}deg at 50% 38%, ${a}55, ${b}66, ${c}55, ${a}55)`;
}
