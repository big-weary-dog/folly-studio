// The Look panel (SPEC "Globals"): sliders for the look's speed, level, hue, saturation and energy, a palette
// picker showing its roles, and macros to add, rename and set (their range: as the API or a generator gave it).
// Wide: a tab of the bottom dock; phones: the Look tab (macros are set there, not added). It edits look.globals in
// place, keeping only what differs from the defaults. Loaded when the Look tab first shows.
import { GLOBALS, macroNameOk } from '../core/globals.js';
import { PALETTE_ROLES } from '../core/stdlib.js';
import { h, humanize, nextId } from './dom.js';

const HELP = { speed: 'How fast every pattern runs; changes never jump', level: 'Master brightness',
  hue: 'Turns every colour round the wheel', saturation: '0 is grey, 2 is vivid',
  energy: 'Calm to busy: patterns read it as G.energy' };
const fmt = (v) => String(Math.round(v * 100) / 100);

export class GlobalsPanel {
  // o: { look(), palettes: [{ name, low, … }], onChange({ live }) }
  constructor(o) {
    Object.assign(this, { o, sliders: new Map(), macroSig: '' });
    this.palette = h('select', { class: 'palette-select', id: nextId('pal'),
      onChange: () => this._setPalette(this.palette.value) },
    h('option', { value: '', text: 'Default (chapel)' }),
    o.palettes.map((p) => h('option', { value: p.name, text: humanize(p.name) })));
    this.swatches = h('div', { class: 'swatches', 'aria-label': 'Palette roles' });
    this.macros = h('ul', { class: 'macro-list' });
    this.el = h('div', { class: 'look-globals' },
      h('section', { class: 'globals-sliders', 'aria-label': 'Globals' },
        Object.entries(GLOBALS).map(([key, d]) => this._slider(key, d))),
      h('section', { class: 'globals-palette', 'aria-label': 'Palette' },
        h('label', { for: this.palette.id, class: 'globals-h', text: 'Palette' }), this.palette, this.swatches),
      h('section', { class: 'globals-macros', 'aria-label': 'Macros' },
        h('div', { class: 'globals-h-row' }, h('h3', { class: 'globals-h', text: 'Macros' }),
          h('button', { type: 'button', class: 'btn small wide-only', text: '+ Macro',
            onClick: () => this._addMacro() })),
        this.macros));
  }

  get g() { return (this.o.look().globals ||= {}); }
  _changed(live = false) { this.o.onChange({ live }); }

  _slider(key, d) {
    const id = nextId('glb'), help = HELP[key];
    const range = h('input', { type: 'range', id, min: d.min, max: d.max, step: key === 'speed' ? 0.05 : 0.01,
      title: help });
    const out = h('output', { class: 'globals-out', for: id });
    const auto = h('span', { class: 'globals-auto', text: 'automated', hidden: true });
    const set = (live) => {
      const v = +range.value;
      if (v === d.value) delete this.g[key]; else this.g[key] = v;
      out.textContent = fmt(v);
      this._changed(live);
    };
    range.addEventListener('input', () => set(true));
    range.addEventListener('change', () => set(false));
    range.addEventListener('dblclick', () => { range.value = String(d.value); set(false); });
    this.sliders.set(key, { range, out, auto, d });
    return h('div', { class: 'globals-row' }, h('label', { for: id, text: humanize(key), title: help }), range, out,
      auto);
  }

  _setPalette(name) {
    const p = this.o.palettes.find((x) => x.name === name);
    if (p) this.g.palette = Object.fromEntries([['name', p.name], ...PALETTE_ROLES.map((r) => [r, [...p[r]]])]);
    else delete this.g.palette;
    this.render();
    this._changed();
  }

  _addMacro() {
    const macros = (this.g.macros ||= {});
    let n = 1;
    while (macros[`macro${n}`]) n++;
    macros[`macro${n}`] = { value: 0.5, min: 0, max: 1 };
    this.render();
    this._changed();
  }

  /** Bring the controls in line with the look (after a load, an edit elsewhere, an undo). */
  render() {
    const g = this.g, lanes = this.o.look().automation || {};
    for (const [key, s] of this.sliders) {
      const v = typeof g[key] === 'number' ? g[key] : s.d.value;
      if (document.activeElement !== s.range) s.range.value = String(v);
      s.out.textContent = fmt(v);
      s.auto.hidden = !lanes[key];
      s.range.disabled = !!lanes[key];
    }
    const named = g.palette?.name && this.o.palettes.some((p) => p.name === g.palette.name);
    this.palette.value = named ? g.palette.name : '';
    const pal = g.palette || this.o.palettes.find((p) => p.name === 'chapel');
    this.swatches.replaceChildren(...PALETTE_ROLES.map((r) => h('div', { class: 'swatch-row' },
      h('span', { class: 'swatch-role', text: humanize(r) }),
      (pal?.[r] || []).map((c) => h('span', { class: 'swatch', title: c, style: { 'background-color': c } })))));
    const sig = JSON.stringify(g.macros || {}) + JSON.stringify(Object.keys(lanes));
    if (sig !== this.macroSig || !this.macros.contains(document.activeElement)) {
      this.macroSig = sig;
      this.macros.replaceChildren(...Object.entries(g.macros || {}).map(([name, m]) => this._macro(name, m, lanes)));
    }
  }

  _macro(name, m, lanes) {
    const id = nextId('mac');
    const nameIn = h('input', { type: 'text', class: 'macro-name', value: name, maxlength: 32, spellcheck: false,
      'aria-label': `Name of macro ${name}`, onChange: () => {
        const to = nameIn.value.trim();
        if (to === name) return;
        if (!macroNameOk(to) || this.g.macros[to]) { nameIn.value = name; return; }
        this.g.macros = Object.fromEntries(Object.entries(this.g.macros).map(([k, v]) => [k === name ? to : k, v]));
        this._rename(name, to);
      } });
    const range = h('input', { type: 'range', id, min: m.min, max: m.max, step: (m.max - m.min) / 100, value: m.value,
      disabled: !!lanes[name] });
    const out = h('output', { class: 'globals-out', for: id, text: fmt(m.value) });
    const set = (live) => { m.value = +range.value; out.textContent = fmt(m.value); this._changed(live); };
    range.addEventListener('input', () => set(true));
    range.addEventListener('change', () => set(false));
    const del = h('button', { type: 'button', class: 'icon-btn wide-only', text: '×', 'aria-label': `Delete ${name}`,
      onClick: () => {
        delete this.g.macros[name];
        if (!Object.keys(this.g.macros).length) delete this.g.macros;
        this._rename(name, null);
      } });
    return h('li', { class: 'macro' }, nameIn, h('label', { for: id, class: 'sr-only', text: `${name} value` }), range,
      out, del, lanes[name] ? h('span', { class: 'globals-auto', text: 'automated' }) : null);
  }

  /** A macro renamed (to null: deleted): its automation lane and the params bound to it follow. */
  _rename(from, to) {
    const look = this.o.look(), auto = look.automation;
    if (auto?.[from]) {
      if (to) auto[to] = auto[from];
      delete auto[from];
      if (!Object.keys(auto).length) delete look.automation;
    }
    for (const m of look.layers.flatMap((l) => l.modules)) {
      for (const [k, b] of Object.entries(m.params || {})) {
        if (b?.mod === 'global' && b.name === from) { if (to) b.name = to; else delete m.params[k]; }
      }
    }
    this.render();
    this._changed();
  }
}
