// Controls for a module's `params` (SPEC "Pattern code"): numbers become sliders (each can be modulated: SPEC
// "Param bindings"), `type: 'color'` colour pickers, `type: 'toggle'` switches.
import { h, clear, nextId, humanize } from './dom.js';

/** Is v a param binding ({ mod: 'lfo' | 'global' | 'envelope', … }) rather than a value? */
export const isBinding = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.mod === 'string';
const fmt3 = (v) => String(Math.round(v * 1000) / 1000);

/** A binding in a few words: "LFO sine · 0.25 Hz", "energy → 0–2", "envelope → 0–1". */
export function bindingText(b) {
  if (!isBinding(b)) return '';
  if (b.mod === 'lfo') return `LFO ${b.shape || 'sine'} · ${fmt3(b.rate ?? 1)} ${b.unit === 'beats' ? '/beat' : 'Hz'}`;
  const range = b.from !== undefined || b.to !== undefined ? ` → ${fmt3(b.from ?? 0)}–${fmt3(b.to ?? 1)}` : '';
  return `${b.mod === 'global' ? b.name : 'envelope'}${range}`;
}

/** Normalise one schema entry into { kind, value, min, max, step, label }. */
export function normaliseParam(key, raw) {
  const label = (raw && typeof raw === 'object' && typeof raw.label === 'string') ? raw.label : humanize(key);
  if (raw == null || typeof raw !== 'object') {
    if (typeof raw === 'boolean') return { kind: 'toggle', value: raw, label };
    if (typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw)) return { kind: 'color', value: raw, label };
    if (typeof raw === 'number') {
      return { kind: 'number', value: raw, min: Math.min(0, raw), max: Math.max(1, raw * 2), step: 0.01, label };
    }
    return null;
  }
  const v = raw.value;
  if (raw.type === 'color' || (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))) {
    return { kind: 'color', value: toHex(v), label };
  }
  if (raw.type === 'toggle' || typeof v === 'boolean') return { kind: 'toggle', value: !!v, label };
  if (typeof v === 'number') {
    let min = Number.isFinite(raw.min) ? raw.min : Math.min(0, v);
    let max = Number.isFinite(raw.max) ? raw.max : Math.max(1, v * 2);
    if (max <= min) max = min + 1;
    const step = Number.isFinite(raw.step) && raw.step > 0 ? raw.step : niceStep((max - min) / 200);
    return { kind: 'number', value: v, min, max, step, label };
  }
  return null;
}

function niceStep(x) {
  if (!(x > 0)) return 0.01;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m < 2 ? 1 : m < 5 ? 2 : 5) * p;
}

export function toHex(v) {
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (typeof v === 'string' && /^#[0-9a-f]{3}$/i.test(v)) {
    return `#${[...v.slice(1)].map((c) => c + c).join('')}`.toLowerCase();
  }
  const byte = (c) => Math.round(Math.min(1, Math.max(0, +c || 0)) * 255).toString(16).padStart(2, '0');
  if (Array.isArray(v) && v.length >= 3) return `#${v.slice(0, 3).map(byte).join('')}`;
  return '#ffffff';
}

function decimals(step) {
  const s = String(step);
  if (s.includes('e-')) return +s.split('e-')[1];
  return s.includes('.') ? s.split('.')[1].length : 0;
}

export class ParamsPanel {
  constructor(container, handlers) {
    Object.assign(this, { h: handlers, body: h('div', { class: 'params' }), sig: null, controls: new Map() });
    container.append(this.body);
  }

  /** set(key (layer/module), schema (the code's `params`, from the sandbox), values (module.params), note?) */
  set(layerId, schema, values, note) {
    const entries = schema && typeof schema === 'object'
      ? Object.entries(schema).map(([k, raw]) => [k, normaliseParam(k, raw)]).filter(([, p]) => p)
      : [];
    const sig = layerId + '|' + JSON.stringify(entries) + '|' + (note?.message || '');
    if (sig !== this.sig) {
      this.sig = sig;
      this._build(layerId, entries, note);
    }
    this._values(values || {});
  }

  _build(layerId, entries, note) {
    clear(this.body);
    this.controls.clear();
    if (!layerId) {
      this.body.append(h('p', { class: 'pane-hint', text: 'Select a layer to see its settings.' }));
      return;
    }
    if (note?.message) this.body.append(h('p', { class: 'pane-hint', text: note.message }));
    if (!entries.length) {
      if (!note?.message) {
        this.body.append(h('p', { class: 'pane-hint' }, 'This pattern has no params. Declare ',
          h('code', { text: 'const params = { … }' }), ' in its code to get sliders here.'));
      }
      return;
    }
    for (const [key, p] of entries) this.body.append(this._control(key, p));
    this.body.append(h('div', { class: 'params-foot' }, h('button', { type: 'button', class: 'btn small ghost',
      text: 'Reset all to defaults', onClick: () => this.h.onResetAll() })));
  }

  _control(key, p) {
    const id = nextId('prm');
    const reset = h('button', { type: 'button', class: 'param-reset', 'aria-label': `Reset ${p.label} to default`,
      title: 'Reset to default', text: '↺', onClick: () => this.h.onReset(key) });
    const c = { p, reset };
    let field;
    let mod = null;
    if (p.kind === 'number') {
      c.modBtn = mod = h('button', { type: 'button', class: 'param-mod', text: '∿', 'aria-pressed': 'false',
        'aria-label': `Modulate ${p.label}`, title: 'Modulate: an LFO, a global or the clip envelope',
        onClick: () => this.h.onModulate(key, p) });
      c.chip = h('span', { class: 'param-chip', hidden: true });
      c.range = h('input', { type: 'range', id, min: p.min, max: p.max, step: p.step });
      c.num = h('input', { type: 'number', class: 'param-num', min: p.min, max: p.max, step: p.step,
        'aria-label': `${p.label} value` });
      const dec = Math.min(4, decimals(p.step));
      c.fmt = (v) => (+v).toFixed(dec);
      c.range.addEventListener('input', () => {
        c.num.value = c.fmt(c.range.value);
        this.h.onChange(key, +c.range.value, { live: true });
      });
      c.range.addEventListener('change', () => this.h.onChange(key, +c.range.value));
      c.num.addEventListener('change', () => {
        const v = parseFloat(c.num.value);
        this.h.onChange(key, Number.isFinite(v) ? v : p.value);
      });
      field = h('div', { class: 'param-field' }, c.range, c.num, c.chip);
    } else if (p.kind === 'color') {
      c.color = h('input', { type: 'color', id, class: 'param-color' });
      c.hex = h('span', { class: 'param-hex' });
      c.color.addEventListener('input', () => {
        c.hex.textContent = c.color.value;
        this.h.onChange(key, c.color.value, { live: true });
      });
      c.color.addEventListener('change', () => this.h.onChange(key, c.color.value));
      field = h('div', { class: 'param-field' }, c.color, c.hex);
    } else {
      c.toggle = h('input', { type: 'checkbox', id, class: 'switch' });
      c.toggle.addEventListener('change', () => this.h.onChange(key, c.toggle.checked));
      field = h('div', { class: 'param-field' }, c.toggle);
    }
    this.controls.set(key, c);
    return h('div', { class: ['param', `param-${p.kind}`] },
      h('div', { class: 'param-head' }, h('label', { for: id, text: p.label }), mod, reset),
      field);
  }

  _values(values) {
    for (const [key, c] of this.controls) {
      const has = Object.prototype.hasOwnProperty.call(values, key), p = c.p;
      let v;
      if (p.kind === 'number') {
        const bound = has && isBinding(values[key]);
        c.range.disabled = c.num.disabled = bound;
        c.chip.hidden = !bound;
        c.chip.textContent = bound ? bindingText(values[key]) : '';
        c.modBtn.setAttribute('aria-pressed', String(bound));
        v = has && !bound && Number.isFinite(+values[key]) ? +values[key] : p.value;
        if (bound) v = NaN;
        else if (document.activeElement !== c.range && +c.range.value !== v) c.range.value = String(v);
        if (document.activeElement !== c.num) c.num.value = bound ? '' : c.fmt(v);
      } else if (p.kind === 'color') {
        v = has ? toHex(values[key]) : p.value;
        if (c.color.value !== v) c.color.value = v;
        c.hex.textContent = v;
      } else c.toggle.checked = v = has ? !!values[key] : p.value;
      c.reset.hidden = !has || v === p.value;
    }
  }
}
