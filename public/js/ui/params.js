// Controls for a module's `params` (SPEC "Pattern code"): numbers become sliders, `type: 'color'` colour pickers,
// `type: 'toggle'` switches. A number can be modulated (SPEC "Param bindings"): an LFO, a global (energy, a macro…)
// or the clip envelope moves it every frame instead of its slider.
import { field, h, humanize, nextId, openDialog } from './dom.js';

/** Is v a param binding ({ mod: 'lfo' | 'global' | 'envelope', … }) rather than a value? */
const isBinding = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.mod === 'string';
const fmt = (v) => String(Math.round(v * 1000) / 1000);
const HEX = /^#[0-9a-f]{6}$/i;

/** A binding in a few words: "LFO sine · 0.25 Hz", "energy → 0–2", "envelope → 0–1". */
function bindingText(b) {
  if (b.mod === 'lfo') return `LFO ${b.shape || 'sine'} · ${fmt(b.rate ?? 1)} ${b.unit === 'beats' ? '/beat' : 'Hz'}`;
  const range = b.from !== undefined || b.to !== undefined ? ` → ${fmt(b.from ?? 0)}–${fmt(b.to ?? 1)}` : '';
  return `${b.mod === 'global' ? b.name : 'envelope'}${range}`;
}

/** One entry of the core's schema (normalizeParams) as { kind, value, min, max, step, label }, or null. */
function normaliseParam(key, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = typeof raw.label === 'string' ? raw.label : humanize(key), v = raw.value;
  if (raw.type === 'color') return { kind: 'color', value: toHex(v), label };
  if (raw.type === 'toggle') return { kind: 'toggle', value: !!v, label };
  if (typeof v !== 'number') return null;
  const min = Number.isFinite(raw.min) ? raw.min : 0, max = raw.max > min ? raw.max : min + 1;
  const x = (max - min) / 200, p = 10 ** Math.floor(Math.log10(x)), nice = (x / p < 2 ? 1 : x / p < 5 ? 2 : 5) * p;
  return { kind: 'number', value: v, min, max, step: raw.step > 0 ? raw.step : nice, label };
}

/** A colour value ('#rrggbb' or [r, g, b] 0..1) as '#rrggbb'. */
function toHex(v) {
  if (typeof v === 'string' && HEX.test(v)) return v.toLowerCase();
  const byte = (c) => Math.round(Math.min(1, Math.max(0, +c || 0)) * 255).toString(16).padStart(2, '0');
  return Array.isArray(v) && v.length >= 3 ? `#${v.slice(0, 3).map(byte).join('')}` : '#ffffff';
}

const decimals = (step) => {
  const [m, e] = String(step).split('e-');
  return Math.min(4, e ? +e : (m.split('.')[1] || '').length);
};

export class ParamsPanel {
  // handlers: { onChange(key, value, { live }?), onReset(key), onResetAll(), globals() → names, binding(key),
  //   onModulate(key, binding | null) }
  constructor(container, handlers) {
    Object.assign(this, { h: handlers, body: h('div', { class: 'params' }), sig: null, controls: new Map() });
    container.append(this.body);
  }

  /** set(key (layer/module), schema (the code's `params`, from the sandbox), values (module.params), note?) */
  set(layerId, schema, values, note) {
    const entries = Object.entries(schema && typeof schema === 'object' ? schema : {})
      .map(([k, raw]) => [k, normaliseParam(k, raw)]).filter(([, p]) => p);
    const sig = layerId + '|' + JSON.stringify(entries) + '|' + (note?.message || '');
    if (sig !== this.sig) { this.sig = sig; this._build(layerId, entries, note); }
    this._values(values || {});
  }

  _build(layerId, entries, note) {
    this.controls.clear();
    const hint = (...kids) => h('p', { class: 'pane-hint' }, ...kids);
    this.body.replaceChildren(!layerId ? hint('Select a layer to see its settings.')
      : note?.message ? hint(note.message)
      : entries.length ? '' : hint('This pattern has no params. Declare ',
        h('code', { text: 'const params = { … }' }), ' in its code to get sliders here.'));
    if (!layerId || !entries.length) return;
    for (const [key, p] of entries) this.body.append(this._control(key, p));
    this.body.append(h('div', { class: 'params-foot' }, h('button', { type: 'button', class: 'btn small ghost',
      text: 'Reset all to defaults', onClick: () => this.h.onResetAll() })));
  }

  _control(key, p) {
    const id = nextId('prm'), on = this.h;
    const c = { p, reset: h('button', { type: 'button', class: 'param-reset', text: '↺', title: 'Reset to default',
      'aria-label': `Reset ${p.label} to default`, onClick: () => on.onReset(key) }) };
    // A control's input event previews (live), its change event commits.
    const input = (el, read, show = () => {}) => {
      el.addEventListener('input', () => { show(); on.onChange(key, read(), { live: true }); });
      el.addEventListener('change', () => on.onChange(key, read()));
      return el;
    };
    let field;
    if (p.kind === 'number') {
      c.modBtn = h('button', { type: 'button', class: 'param-mod', text: '∿', 'aria-pressed': 'false',
        'aria-label': `Modulate ${p.label}`, title: 'Modulate: an LFO, a global or the clip envelope',
        onClick: () => this._modulate(key, p) });
      c.chip = h('span', { class: 'param-chip', hidden: true });
      c.fmt = (v) => (+v).toFixed(decimals(p.step));
      c.range = input(h('input', { type: 'range', id, min: p.min, max: p.max, step: p.step }), () => +c.range.value,
        () => { c.num.value = c.fmt(c.range.value); });
      c.num = h('input', { type: 'number', class: 'param-num', min: p.min, max: p.max, step: p.step,
        'aria-label': `${p.label} value`, onChange: () => {
          const v = parseFloat(c.num.value);
          on.onChange(key, Number.isFinite(v) ? v : p.value);
        } });
      field = [c.range, c.num, c.chip];
    } else if (p.kind === 'color') {
      c.hex = h('span', { class: 'param-hex' });
      c.color = input(h('input', { type: 'color', id, class: 'param-color' }), () => c.color.value,
        () => { c.hex.textContent = c.color.value; });
      field = [c.color, c.hex];
    } else {
      c.toggle = h('input', { type: 'checkbox', id, class: 'switch',
        onChange: () => on.onChange(key, c.toggle.checked) });
      field = [c.toggle];
    }
    this.controls.set(key, c);
    return h('div', { class: ['param', `param-${p.kind}`] },
      h('div', { class: 'param-head' }, h('label', { for: id, text: p.label }), c.modBtn, c.reset),
      h('div', { class: 'param-field' }, field));
  }

  _values(values) {
    for (const [key, c] of this.controls) {
      const has = Object.hasOwn(values, key), p = c.p;
      let v;
      if (p.kind === 'number') {
        const bound = has && isBinding(values[key]);
        c.range.disabled = c.num.disabled = bound;
        c.chip.hidden = !bound;
        c.chip.textContent = bound ? bindingText(values[key]) : '';
        c.modBtn.setAttribute('aria-pressed', String(bound));
        v = bound ? NaN : has && Number.isFinite(+values[key]) ? +values[key] : p.value;
        if (!bound && document.activeElement !== c.range && +c.range.value !== v) c.range.value = String(v);
        if (document.activeElement !== c.num) c.num.value = bound ? '' : c.fmt(v);
      } else if (p.kind === 'color') {
        v = has ? toHex(values[key]) : p.value;
        if (c.color.value !== v) c.color.value = v;
        c.hex.textContent = v;
      } else c.toggle.checked = v = has ? !!values[key] : p.value;
      c.reset.hidden = !has || v === p.value;
    }
  }

  /** The modulate dialog for number param `key`: an LFO, a global or the clip envelope, or nothing. */
  _modulate(key, p) {
    const b = isBinding(this.h.binding(key)) ? this.h.binding(key) : {};
    return openDialog({ title: `Modulate ${p.label}`, className: 'modulate-dialog', build: (close) => {
      const num = (value, aria) => h('input', { type: 'number', step: 'any', value: fmt(value), 'aria-label': aria });
      const select = (opts, value) => {
        const s = h('select', {}, opts.map(([v, t]) => h('option', { value: v, text: t })));
        s.value = opts.some(([v]) => v === value) ? value : opts[0][0];
        return s;
      };
      const mode = select([['', 'Nothing: the slider sets it'], ['lfo', 'An LFO'], ['global', 'A global'],
        ['envelope', 'The clip envelope']], b.mod || '');
      const shape = select(['sine', 'tri', 'saw', 'square'].map((s) => [s, humanize(s)]), b.shape);
      const rate = num(b.rate ?? 0.25), unit = select([['hz', 'a second (Hz)'], ['beats', 'a beat']], b.unit);
      const center = num(b.center ?? p.value), depth = num(b.depth ?? (p.max - p.min) / 4);
      const name = select(this.h.globals().map((g) => [g, humanize(g)]), b.name);
      const ends = (mod) => [num(b.mod === mod ? b.from ?? p.min : p.min), num(b.mod === mod ? b.to ?? p.max : p.max)];
      const [from, to] = ends('global'), [eFrom, eTo] = ends('envelope');
      const row = (...kids) => h('div', { class: 'mod-row' }, ...kids);
      const groups = {
        lfo: h('div', { class: 'mod-fields' }, row(field('Shape', shape), field('Cycles', rate), field('Per', unit)),
          row(field('Centre', center), field('Depth (±)', depth))),
        global: h('div', { class: 'mod-fields' }, field('Global', name),
          row(field('At its lowest', from), field('At its highest', to))),
        envelope: h('div', { class: 'mod-fields' }, row(field('Outside clips', eFrom), field('Fully in', eTo))),
      };
      const show = () => { for (const [k, el] of Object.entries(groups)) el.hidden = mode.value !== k; };
      mode.addEventListener('change', show);
      show();
      const n = (el, d) => { const v = parseFloat(el.value); return Number.isFinite(v) ? v : d; };
      const apply = () => {
        const m = mode.value;
        close();
        this.h.onModulate(key, !m ? null : m === 'lfo' ? { mod: 'lfo', shape: shape.value, rate: n(rate, 1),
          unit: unit.value, center: n(center, p.value), depth: n(depth, (p.max - p.min) / 4) }
          : m === 'global' ? { mod: 'global', name: name.value, from: n(from, p.min), to: n(to, p.max) }
            : { mod: 'envelope', from: n(eFrom, p.min), to: n(eTo, p.max) });
      };
      return [
        h('p', { class: 'dialog-text', text: `Range ${fmt(p.min)} to ${fmt(p.max)}. A modulated value is held to `
          + 'it.' }),
        field('Moved by', mode), ...Object.values(groups),
        h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onClick: () => close() }),
          h('button', { type: 'button', class: 'btn primary', text: 'Apply', onClick: apply })),
      ];
    } });
  }
}
