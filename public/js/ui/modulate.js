// Modulating a number param (SPEC "Param bindings"): an LFO, a global (energy, a macro…) or the clip envelope moves
// it every frame instead of its slider. Loaded when first opened.
import { field, h, humanize, openDialog } from './dom.js';
import { isBinding } from './params.js';

const MODES = [['', 'Nothing: the slider sets it'], ['lfo', 'An LFO'], ['global', 'A global'],
  ['envelope', 'The clip envelope']];
const SHAPES = ['sine', 'tri', 'saw', 'square'];
const fmt = (v) => String(Math.round(v * 1000) / 1000);

/** openModulate({ label, p: { min, max, value }, binding, globals: [names], onApply(binding | null) }) */
export function openModulate({ label, p, binding, globals, onApply }) {
  return openDialog({ title: `Modulate ${label}`, className: 'modulate-dialog', build: (close) => {
    const b = isBinding(binding) ? binding : {};
    const num = (value, aria) => h('input', { type: 'number', step: 'any', value: fmt(value), 'aria-label': aria });
    const select = (opts, value) => {
      const s = h('select', {}, opts.map(([v, t]) => h('option', { value: v, text: t })));
      s.value = opts.some(([v]) => v === value) ? value : opts[0][0];
      return s;
    };
    const mode = select(MODES, b.mod || '');
    const shape = select(SHAPES.map((s) => [s, humanize(s)]), b.shape);
    const rate = num(b.rate ?? 0.25), unit = select([['hz', 'a second (Hz)'], ['beats', 'a beat']], b.unit);
    const center = num(b.center ?? p.value), depth = num(b.depth ?? (p.max - p.min) / 4);
    const name = select(globals.map((g) => [g, humanize(g)]), b.name);
    const g = b.mod === 'global';
    const from = num(g ? b.from ?? p.min : p.min), to = num(g ? b.to ?? p.max : p.max);
    const eFrom = num(b.mod === 'envelope' ? b.from ?? p.min : p.min);
    const eTo = num(b.mod === 'envelope' ? b.to ?? p.max : p.max);
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
      onApply(!m ? null : m === 'lfo' ? { mod: 'lfo', shape: shape.value, rate: n(rate, 1), unit: unit.value,
        center: n(center, p.value), depth: n(depth, (p.max - p.min) / 4) }
        : m === 'global' ? { mod: 'global', name: name.value, from: n(from, p.min), to: n(to, p.max) }
          : { mod: 'envelope', from: n(eFrom, p.min), to: n(eTo, p.max) });
    };
    return [
      h('p', { class: 'dialog-text', text: `Range ${fmt(p.min)} to ${fmt(p.max)}. A modulated value is held to it.` }),
      field('Moved by', mode), ...Object.values(groups),
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onClick: () => close() }),
        h('button', { type: 'button', class: 'btn primary', text: 'Apply', onClick: apply })),
    ];
  } });
}
