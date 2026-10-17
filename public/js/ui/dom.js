// Small DOM helpers shared by the views. No HTML strings: everything goes through textContent and properties.

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'indeterminate', 'selected',
  'readOnly', 'tabIndex', 'spellcheck', 'open', 'multiple', 'required', 'autofocus']);

/** h('button', { class: 'btn', onClick }, 'Save') */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  setProps(el, props);
  append(el, kids);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
  append(el, kids);
  return el;
}

function setProps(el, props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false && !PROPS.has(k)) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

export function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === true) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

/** A <label> for `control`, which gets an id when it has none. */
export const label = (control, text, cls) => h('label', { for: control.id ||= nextId('f'), class: cls, text });
/** A `.field`: the label, then the control (and anything after it). */
export const field = (text, control, ...after) => h('div', { class: 'field' }, label(control, text), control, ...after);
/** A labelled switch (checkbox): { box, el }. */
export function switchBox(text, cls, attrs = {}) {
  const box = h('input', { type: 'checkbox', class: 'switch', ...attrs });
  return { box, el: h('div', { class: cls }, box, label(box, text)) };
}
/** Mark a button busy (disabled, spinner) or not. */
export const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle('busy', on); };
/** A tiny id generator for form labels and layers. */
let uid = 0;
export function nextId(prefix = 'u') { return `${prefix}${++uid}`; }
export function randomId(prefix = 'l') {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return prefix + a[0].toString(36) + a[1].toString(36).slice(0, 3);
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A remembered preference: pref(key) reads it, pref(key, value) stores it (null where storage is off). */
export function pref(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* private mode etc. */ }
  return null;
}

/** Adds a view's stylesheet once; resolves when it has loaded (or failed: the view still works). */
export function stylesheet(href) {
  let link = document.querySelector(`link[rel=stylesheet][href="${href}"]`);
  if (!link) document.head.append(link = h('link', { rel: 'stylesheet', href }));
  if (link.sheet) return Promise.resolve();
  return new Promise((done) => {
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
  });
}

export function toast(message, { kind = 'info', timeout = 4200, action } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: ['toast', `toast-${kind}`], role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-msg', text: message }));
  if (action) {
    el.append(h('button', { class: 'btn small ghost', type: 'button', text: action.label,
      onClick: () => { action.onClick(); close(); } }));
  }
  el.append(h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss', text: '×',
    onClick: () => close() }));
  host.append(el);
  let timer = timeout ? setTimeout(close, timeout) : null;
  el.addEventListener('pointerenter', () => { clearTimeout(timer); timer = null; });
  el.addEventListener('pointerleave', () => { if (timeout && !timer) timer = setTimeout(close, 1800); });
  function close() {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), reducedMotion() ? 0 : 180);
  }
  return close;
}

/** A modal <dialog>. `build(close)` returns the body; resolves with whatever close() gets. */
export function openDialog({ title, build, className = '', dismissable = true, onClose }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: ['dialog', className], 'aria-labelledby': nextId('dlg') });
    const titleId = dlg.getAttribute('aria-labelledby');
    let result;
    const close = (value) => { result = value; if (dlg.open) dlg.close(); };
    const head = h('header', { class: 'dialog-head' }, h('h2', { id: titleId, text: title }), dismissable
      ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', text: '×', onClick: () => close() })
      : null);
    dlg.append(head, h('div', { class: 'dialog-body' }, build(close)));
    dlg.addEventListener('cancel', (e) => { if (!dismissable) e.preventDefault(); });
    dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(result); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmDialog(message, { title = 'Are you sure?', ok = 'OK', danger = false } = {}) {
  return openDialog({ title, build: (close) => [
    h('p', { class: 'dialog-text', text: message }),
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onClick: () => close(false) }),
      h('button', { class: ['btn', danger ? 'danger' : 'primary'], type: 'button', text: ok, autofocus: true,
        onClick: () => close(true) })),
  ] }).then(Boolean);
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
}

export function timeAgo(when) {
  const t = typeof when === 'number' ? when : Date.parse(when);
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

export function slugify(s, fallback = 'look') {
  const slug = String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
    .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);
  return slug || fallback;
}

export function download(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function humanize(key) {
  return String(key).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Debounce: call fn once `ms` after the last call. `.flush()` runs it now, `.cancel()` drops it. */
export function debounce(fn, ms) {
  let timer = null, args = null;
  const run = () => { timer = null; const a = args; args = null; fn(...a); };
  const d = (...a) => { args = a; clearTimeout(timer); timer = setTimeout(run, ms); };
  d.flush = () => { if (timer) { clearTimeout(timer); run(); } };
  d.cancel = () => { clearTimeout(timer); timer = null; args = null; };
  return d;
}

/** True when keyboard focus is in something that takes typing. */
export function isTyping(target) {
  const el = target instanceof Element ? target : document.activeElement;
  const tag = el?.tagName;
  if (el?.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit', 'color'].includes(el.type);
}

/** A stained-glass swatch for cards: a deterministic gradient from a string. */
const JEWELS = ['#e5486b', '#5b8cff', '#f2b148', '#39c98f', '#a77bff', '#ff7a45', '#36b7d6'];
export function jewelGradient(seed) {
  let x = 2166136261;
  for (const ch of String(seed)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
  const [a, b, c] = [0, 1, 2].map((n) => JEWELS[(x >>> (n * 3)) % JEWELS.length]);
  const ang = (x >>> 8) % 360;
  return `radial-gradient(circle at 50% 38%, ${a}cc 0 10%, transparent 34%),` +
    ` conic-gradient(from ${ang}deg at 50% 38%, ${a}55, ${b}66, ${c}55, ${a}55)`;
}
