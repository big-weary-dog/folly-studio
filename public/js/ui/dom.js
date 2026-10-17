// DOM helpers shared by the views, and the rose. No HTML strings: only nodes, textContent and properties.

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

/** list's children follow items: a row ({ el, … }) per key, made once, updated each time. */
export function keyed(list, rows, items, key, make, update) {
  const keep = new Set(items.map(key));
  for (const [k, r] of rows) if (!keep.has(k)) { r.el.remove(); rows.delete(k); }
  items.forEach((item, i) => {
    let r = rows.get(key(item));
    if (!r) rows.set(key(item), r = make(item));
    if (list.children[i] !== r.el) list.insertBefore(r.el, list.children[i] || null);
    update(r, item, i);
  });
}

/** A <label> for `control`, which gets an id when it has none. */
export const label = (control, text, cls) => h('label', { for: control.id ||= nextId('f'), class: cls, text });
/** A `.field`: the label, then the control. */
export const field = (text, control, ...after) => h('div', { class: 'field' }, label(control, text), control, ...after);
/** A labelled switch (checkbox): { box, el }. */
export function switchBox(text, cls, attrs = {}) {
  const box = h('input', { type: 'checkbox', class: 'switch', ...attrs });
  return { box, el: h('div', { class: cls }, box, label(box, text)) };
}

export const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle('busy', on); };

let uid = 0;
export function nextId(prefix = 'u') { return `${prefix}${++uid}`; }
export function randomId(prefix = 'l') {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return prefix + a[0].toString(36) + a[1].toString(36).slice(0, 3);
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A remembered preference: pref(key) reads it, pref(key, value) stores it. */
export function pref(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* private mode etc. */ }
  return null;
}

/** A view's stylesheet, added once; resolves when it has loaded or failed. */
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

/** fn once `ms` after the last call; `.flush()` runs it now, `.cancel()` drops it. */
export function debounce(fn, ms) {
  let timer = null, args = null;
  const run = () => { timer = null; const a = args; args = null; fn(...a); };
  const d = (...a) => { args = a; clearTimeout(timer); timer = setTimeout(run, ms); };
  d.flush = () => { if (timer) { clearTimeout(timer); run(); } };
  d.cancel = () => { clearTimeout(timer); timer = null; args = null; };
  return d;
}

/** A card's stained glass: a gradient from a string. */
const JEWELS = ['#e5486b', '#5b8cff', '#f2b148', '#39c98f', '#a77bff', '#ff7a45', '#36b7d6'];
export function jewelGradient(seed) {
  let x = 2166136261;
  for (const ch of String(seed)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
  const [a, b, c] = [0, 1, 2].map((n) => JEWELS[(x >>> (n * 3)) % JEWELS.length]);
  const ang = (x >>> 8) % 360;
  return `radial-gradient(circle at 50% 38%, ${a}cc 0 10%, transparent 34%),` +
    ` conic-gradient(from ${ang}deg at 50% 38%, ${a}55, ${b}66, ${c}55, ${a}55)`;
}

// The rose window as SVG: sixteen lancet petals in the real window's seven rings round a hub. The brand mark, the
// loader and an idea's progress; colour and motion live in CSS (.rose in base.css, pages.css).
const PETALS = 16;
const R = 98;                         // the petal tips, in a 200-unit viewBox
// Radii as fractions of the window: the hub, the rings, the shoulder where a petal closes into its point, the tip.
const HUB = 0.184, SHOULDER = 0.73, TIP = 0.99;
const RINGS = [HUB, 0.275, 0.395, 0.512, 0.637, 0.738, 0.832, TIP];
// Cells across each ring and their glass: amber, ruby, cobalt, emerald, violet.
const CELLS = [['a'], ['c', 'c'], ['r'], ['c', 'c'], ['v', 'a', 'v'], ['r', 'r'], ['c', 'e', 'c']];
const SPLITS = { 1: [0, 1], 2: [0, 0.5, 1], 3: [0, 0.27, 0.73, 1] };
const BANDS = [[0, 3, 'c'], [3, 7, 'r']];  // the small mark: two bands, no mullions
const WIDE = 0.1745;                  // a petal's widest half-angle (10° of the 11.25° it has)
const T0 = SHOULDER * WIDE, L = TIP - SHOULDER, RHO = (L * L + T0 * T0) / (2 * T0);

/** A petal's half-angle at radius r: open fast from the hub, close in a pointed arch. */
function halfAngle(r) {
  if (r <= HUB) return 0;
  if (r < SHOULDER) return WIDE * (1 - (1 - Math.min(1, (r - HUB) / 0.3)) ** 3);
  const s = Math.min(L, r - SHOULDER);
  return Math.max(0, Math.sqrt(RHO * RHO - s * s) - (RHO - T0)) / r;
}

const pt = (r, a) => `${(R * r * Math.sin(a)).toFixed(1)} ${(-R * r * Math.cos(a)).toFixed(1)}`;

/** One cell: radii r0..r1, across-the-petal fractions f0..f1, round angle `mid`. */
function cell(mid, r0, r1, f0, f1) {
  const n = r1 > SHOULDER ? 8 : 3;
  const side = (f, from, to) => Array.from({ length: n + 1 }, (_, k) => {
    const r = from + ((to - from) * k) / n;
    return pt(r, mid + (2 * f - 1) * halfAngle(r));
  });
  return `M${side(f0, r0, r1).join('L')}L${side(f1, r1, r0).join('L')}Z`;
}

/** rose({ detail: full | mark (two bands), className, label (else decorative) }) */
export function rose({ detail = 'mark', className = '', label = '' } = {}) {
  const full = detail === 'full';
  const kids = [svg('circle', { class: 'rose-stone', r: 100 })];
  for (let i = 0; i < PETALS; i++) {
    const mid = (i * 2 * Math.PI) / PETALS;
    const petal = svg('g', { class: 'rp', style: `--i:${i}` });
    if (full) {
      CELLS.forEach((glass, ring) => glass.forEach((k, j) => {
        const f = SPLITS[glass.length];
        petal.append(svg('path', { class: `g-${k}`,
          d: cell(mid, RINGS[ring], RINGS[ring + 1], f[j], f[j + 1]) }));
      }));
    } else {
      for (const [a, b, k] of BANDS) {
        petal.append(svg('path', { class: `g-${k}`, d: cell(mid, RINGS[a], RINGS[b], 0, 1) }));
      }
    }
    kids.push(petal);
  }
  kids.push(svg('circle', { class: 'rose-hub g-a', r: (R * HUB * 0.86).toFixed(1) }),
    svg('circle', { class: 'rose-boss', r: (R * HUB * 0.34).toFixed(1) }));
  // Animations run on the page's clock, so a rose drawn again (a list re-rendered) keeps its phase.
  const attrs = { class: `rose rose-${detail} ${className}`.trim(), viewBox: '-100 -100 200 200',
    focusable: 'false', style: `--t0:${-Math.round(performance.now())}ms` };
  if (label) Object.assign(attrs, { role: 'img', 'aria-label': label });
  else attrs['aria-hidden'] = 'true';
  return svg('svg', attrs, ...kids);
}
