// Auto-generated controls for a layer's `params` (SPEC "Pattern code"): numbers become
// sliders, `type: 'color'` colour pickers, `type: 'toggle'` switches.
import { h, clear, nextId, humanize } from './dom.js';

/** Normalise one schema entry into { kind, value, min, max, step, label }. */
export function normaliseParam(key, raw) {
  const label = (raw && typeof raw === 'object' && typeof raw.label === 'string') ? raw.label : humanize(key);
  if (raw == null || typeof raw !== 'object') {
    if (typeof raw === 'boolean') return { kind: 'toggle', value: raw, label };
    if (typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw)) return { kind: 'color', value: raw, label };
    if (typeof raw === 'number') return { kind: 'number', value: raw, min: Math.min(0, raw), max: Math.max(1, raw * 2), step: 0.01, label };
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
  if (typeof v === 'string' && /^#[0-9a-f]{3}$/i.test(v)) return ('#' + [...v.slice(1)].map((c) => c + c).join('')).toLowerCase();
  if (Array.isArray(v) && v.length >= 3) {
    return '#' + v.slice(0, 3).map((c) => Math.round(Math.min(1, Math.max(0, +c || 0)) * 255).toString(16).padStart(2, '0')).join('');
  }
  return '#ffffff';
}

function decimals(step) {
  const s = String(step);
  if (s.includes('e-')) return +s.split('e-')[1];
  return s.includes('.') ? s.split('.')[1].length : 0;
}

export class ParamsPanel {
  constructor(container, handlers) {
    this.h = handlers;
    this.body = h('div', { class: 'params' });
    container.append(this.body);
    this.sig = null;
    this.controls = new Map();
  }

  /**
   * @param {string|null} layerId
   * @param {object|null} schema   the code's `params` as reported by the sandbox
   * @param {object} values        layer.params (overrides)
   * @param {{ message?: string }} [note]
   */
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
        this.body.append(h('p', { class: 'pane-hint' },
          'This pattern has no params. Declare ', h('code', { text: 'const params = { … }' }), ' in its code to get sliders here.'));
      }
      return;
    }
    for (const [key, p] of entries) this.body.append(this._control(key, p));
    this.body.append(h('div', { class: 'params-foot' },
      h('button', { type: 'button', class: 'btn small ghost', text: 'Reset all to defaults', onClick: () => this.h.onResetAll() })));
  }

  _control(key, p) {
    const id = nextId('prm');
    const reset = h('button', { type: 'button', class: 'param-reset', 'aria-label': `Reset ${p.label} to default`, title: 'Reset to default', text: '↺' });
    reset.addEventListener('click', () => this.h.onReset(key));
    const c = { p, reset };
    let field;
    if (p.kind === 'number') {
      c.range = h('input', { type: 'range', id, min: p.min, max: p.max, step: p.step });
      c.num = h('input', { type: 'number', class: 'param-num', min: p.min, max: p.max, step: p.step, 'aria-label': `${p.label} value` });
      const dec = Math.min(4, decimals(p.step));
      c.fmt = (v) => (+v).toFixed(dec);
      c.range.addEventListener('input', () => { c.num.value = c.fmt(c.range.value); this.h.onChange(key, +c.range.value, { live: true }); });
      c.range.addEventListener('change', () => this.h.onChange(key, +c.range.value));
      c.num.addEventListener('change', () => {
        let v = parseFloat(c.num.value);
        if (!Number.isFinite(v)) v = p.value;
        this.h.onChange(key, v);
      });
      field = h('div', { class: 'param-field' }, c.range, c.num);
    } else if (p.kind === 'color') {
      c.color = h('input', { type: 'color', id, class: 'param-color' });
      c.hex = h('span', { class: 'param-hex' });
      c.color.addEventListener('input', () => { c.hex.textContent = c.color.value; this.h.onChange(key, c.color.value, { live: true }); });
      c.color.addEventListener('change', () => this.h.onChange(key, c.color.value));
      field = h('div', { class: 'param-field' }, c.color, c.hex);
    } else {
      c.toggle = h('input', { type: 'checkbox', id, class: 'switch' });
      c.toggle.addEventListener('change', () => this.h.onChange(key, c.toggle.checked));
      field = h('div', { class: 'param-field' }, c.toggle);
    }
    this.controls.set(key, c);
    return h('div', { class: ['param', `param-${p.kind}`] },
      h('div', { class: 'param-head' }, h('label', { for: id, text: p.label }), reset),
      field);
  }

  _values(values) {
    for (const [key, c] of this.controls) {
      const has = Object.prototype.hasOwnProperty.call(values, key);
      const p = c.p;
      if (p.kind === 'number') {
        const v = has && Number.isFinite(+values[key]) ? +values[key] : p.value;
        if (document.activeElement !== c.range && +c.range.value !== v) c.range.value = String(v);
        if (document.activeElement !== c.num) c.num.value = c.fmt(v);
        c.reset.hidden = !has || v === p.value;
      } else if (p.kind === 'color') {
        const v = has ? toHex(values[key]) : p.value;
        if (c.color.value !== v) c.color.value = v;
        c.hex.textContent = v;
        c.reset.hidden = !has || v === p.value;
      } else {
        const v = has ? !!values[key] : p.value;
        c.toggle.checked = v;
        c.reset.hidden = !has || v === p.value;
      }
    }
  }
}
