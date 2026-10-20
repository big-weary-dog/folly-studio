// What every view shares: toasts, modal dialogs, labelled fields and switches, and small helpers. Markup is JSX
// (Preact builds the nodes), never HTML strings.
import { signal, type Signal } from '@preact/signals';
import { type ComponentChildren, render } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

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
  return close;
}

/** A lazy part of the app failed to load: most likely a deploy replaced its file, so a reload fetches the new one. */
export const loadFailed = () => toast('Folly Studio was updated. Reload to carry on.',
  { kind: 'error', timeout: 0, action: { label: 'Reload', onClick: () => location.reload() } });

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
      const ref = useRef<HTMLDialogElement>(null), titleId = useId();
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

/** A `.field`, one row: its label, then the control (given the label's id), or a read-only value. A label too long
 * for the label column takes its own line; `stack` always does, for what one line cannot hold (multi-line text). */
export function Field({ label, children, hint, stack, class: cls, title }: { label: ComponentChildren;
  children: ComponentChildren | ((id: string) => ComponentChildren); hint?: ComponentChildren; stack?: boolean;
  class?: string; title?: string }) {
  const id = useId(), control = typeof children === 'function';
  return (
    <div class={cx('field', stack && 'stack', cls)} title={title}>
      {control ? <label for={id}>{label}</label> : <span>{label}</span>}
      <div class="field-control">{control ? children(id) : children}</div>{hint}</div>);
}

type Range = { min: number; max: number; step: number };
/** The decimals a step shows (0.05 → 2, at most 4). */
export function decimals(step: number) {
  const [m, e] = String(step).split('e-');
  return Math.min(4, e ? Number(e) : (m.split('.')[1] || '').length);
}
/** v on the step's grid from min, held to min..max. */
export const snap = (v: number, { min, max, step }: Range) =>
  Math.min(max, Math.max(min, Number((min + Math.round((v - min) / step) * step).toPrecision(12))));
/** From v, a drag of dx px across a field w px wide: its width spans the range (`fine`: a tenth of that). */
export const scrubTo = (v: number, dx: number, w: number, r: Range, fine = false) =>
  snap(v + (dx / Math.max(1, w)) * (r.max - r.min) * (fine ? 0.1 : 1), r);

/** A number as one field, its glass filled to where the value sits in min..max. Drag across it or its label to
 * scrub (Shift: finer); click or tap to type; ↑/↓ (Shift: ×10), and the wheel while focused, step it. */
export function Scrub({ id, label, value, unit = '', disabled, set, ...r }: Range & { id?: string; label?: string;
  value: number; unit?: string; disabled?: boolean; set: (v: number) => void }) {
  const ref = useRef<HTMLInputElement>(null), now = useRef({ value, set, r });
  const text = (v: number) => v.toFixed(decimals(r.step)) + unit;
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
    aria-valuetext={text(value)} style={{ '--fill': ((snap(value, r) - r.min) / (r.max - r.min || 1)).toFixed(3) }}
    onChange={(e) => put(snap(num(e.currentTarget), r), e.currentTarget)}
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

/** A module loaded on first use, once `when` holds (null until it has loaded). */
export function useLazy<T>(load: () => Promise<T>, when = true): T | null {
  const [mod, setMod] = useState<T | null>(null);
  useEffect(() => { if (when && !mod) load().then((m) => setMod(() => m)); }, [when]);
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
