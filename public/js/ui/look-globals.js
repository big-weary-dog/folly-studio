// The Look panel (SPEC "Globals"): sliders for the look's speed, level, hue, saturation and energy, a palette
// picker showing its roles, and macros to add, rename and set (their range: as the API or a generator gave it).
// Wide: a tab of the bottom dock; phones: the Look tab (macros are set there, not added). It edits look.globals in
// place, keeping only what differs from the defaults. Loaded when the Look tab first shows.
import { h, humanize, nextId } from './dom.js';

export const GLOBALS = [
  { key: 'speed', min: 0, max: 4, step: 0.05, value: 1, help: 'How fast every pattern runs; changes never jump' },
  { key: 'level', min: 0, max: 1, step: 0.01, value: 1, help: 'Master brightness' },
  { key: 'hue', min: -0.5, max: 0.5, step: 0.01, value: 0, help: 'Turns every colour round the wheel' },
  { key: 'saturation', min: 0, max: 2, step: 0.01, value: 1, help: '0 is grey, 2 is vivid' },
  { key: 'energy', min: 0, max: 1, step: 0.01, value: 0.5, help: 'Calm to busy: patterns read it as G.energy' },
];
export const ROLES = ['low', 'body', 'accent', 'high'];
const MACRO_NAME = /^[a-z][A-Za-z0-9_]{0,31}$/;
const RESERVED = new Set([...GLOBALS.map((g) => g.key), 'palette']);
export const macroNameOk = (n) => MACRO_NAME.test(n) && !RESERVED.has(n) && !(n in Object.prototype);
const fmt = (v) => String(Math.round(v * 100) / 100);

export class GlobalsPanel {
  // o: { look(), palettes: [{ name, low, … }], onChange({ live }), onRenameMacro(from, to) }
  constructor(o) {
    Object.assign(this, { o, sliders: new Map(), macroSig: '' });
    const rows = GLOBALS.map((g) => this._slider(g));
    this.palette = h('select', { class: 'palette-select', id: nextId('pal') },
      h('option', { value: '', text: 'Default (chapel)' }), o.palettes.map((p) => h('option', { value: p.name,
        text: humanize(p.name) })));
    this.palette.addEventListener('change', () => this._setPalette(this.palette.value));
    this.swatches = h('div', { class: 'swatches', 'aria-label': 'Palette roles' });
    this.macros = h('ul', { class: 'macro-list' });
    this.el = h('div', { class: 'look-globals' },
      h('section', { class: 'globals-sliders', 'aria-label': 'Globals' }, rows),
      h('section', { class: 'globals-palette', 'aria-label': 'Palette' },
        h('label', { for: this.palette.id, class: 'globals-h', text: 'Palette' }), this.palette, this.swatches),
      h('section', { class: 'globals-macros', 'aria-label': 'Macros' },
        h('div', { class: 'globals-h-row' }, h('h3', { class: 'globals-h', text: 'Macros' }),
          h('button', { type: 'button', class: 'btn small wide-only', text: '+ Macro',
            onClick: () => this._addMacro() })),
        this.macros));
  }

  get g() { return (this.o.look().globals ||= {}); }

  _slider(d) {
    const id = nextId('glb');
    const range = h('input', { type: 'range', id, min: d.min, max: d.max, step: d.step, title: d.help });
    const out = h('output', { class: 'globals-out', for: id });
    const auto = h('span', { class: 'globals-auto', text: 'automated', hidden: true });
    const set = (live) => {
      const v = +range.value;
      if (v === d.value) delete this.g[d.key]; else this.g[d.key] = v;
      out.textContent = fmt(v);
      this.o.onChange({ live });
    };
    range.addEventListener('input', () => set(true));
    range.addEventListener('change', () => set(false));
    range.addEventListener('dblclick', () => { range.value = String(d.value); set(false); });
    this.sliders.set(d.key, { range, out, auto, d });
    return h('div', { class: 'globals-row' }, h('label', { for: id, text: humanize(d.key), title: d.help }), range, out,
      auto);
  }

  _setPalette(name) {
    const p = this.o.palettes.find((x) => x.name === name);
    if (p) this.g.palette = Object.fromEntries([['name', p.name], ...ROLES.map((r) => [r, [...p[r]]])]);
    else delete this.g.palette;
    this.render();
    this.o.onChange({ live: false });
  }

  _addMacro() {
    const macros = (this.g.macros ||= {});
    let n = 1;
    while (macros[`macro${n}`]) n++;
    macros[`macro${n}`] = { value: 0.5, min: 0, max: 1 };
    this.render();
    this.o.onChange({ live: false });
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
    this.swatches.replaceChildren(...ROLES.map((r) => h('div', { class: 'swatch-row' },
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
      'aria-label': `Name of macro ${name}` });
    nameIn.addEventListener('change', () => {
      const to = nameIn.value.trim();
      if (to === name) return;
      if (!macroNameOk(to) || this.g.macros[to]) {
        nameIn.value = name;
        return;
      }
      this.g.macros = Object.fromEntries(Object.entries(this.g.macros).map(([k, v]) => [k === name ? to : k, v]));
      this.o.onRenameMacro(name, to);
      this.render();
    });
    const step = (m.max - m.min) / 100;
    const range = h('input', { type: 'range', id, min: m.min, max: m.max, step, value: m.value,
      disabled: !!lanes[name] });
    const out = h('output', { class: 'globals-out', for: id, text: fmt(m.value) });
    const set = (live) => { m.value = +range.value; out.textContent = fmt(m.value); this.o.onChange({ live }); };
    range.addEventListener('input', () => set(true));
    range.addEventListener('change', () => set(false));
    const del = h('button', { type: 'button', class: 'icon-btn wide-only', text: '×', 'aria-label': `Delete ${name}`,
      onClick: () => {
        delete this.g.macros[name];
        if (!Object.keys(this.g.macros).length) delete this.g.macros;
        this.o.onRenameMacro(name, null);
        this.render();
      } });
    return h('li', { class: 'macro' }, nameIn, h('label', { for: id, class: 'sr-only', text: `${name} value` }), range,
      out, del,
      lanes[name] ? h('span', { class: 'globals-auto', text: 'automated' }) : null);
  }
}
