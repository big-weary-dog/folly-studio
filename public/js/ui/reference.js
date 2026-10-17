// Quick reference of the pattern API (SPEC "Pattern code"). Click a name to insert it.
import { h } from './dom.js';

const FIELDS = [
  ['x y z', '0..1 across the whole cathedral (depth, height, left→right)'],
  ['X Y Z', 'metres'],
  ['lx ly lz', '0..1 across the pixels this layer targets — a pattern fills what it lands on'],
  ['a r', 'angle 0..1 (clockwise from 12 o’clock, seen from the playa) and radius 0..1 on the façade, round this layer’s centre'],
  ['u i n', 'position 0..1 along its strand, index along it, strand length'],
  ['zone zi strand', 'zone name, zone index, strand index'],
  ['row petal', 'rose ring 1–7 and petal 0–15 (0 / −1 elsewhere)'],
  ['k seed', 'global LED index; a stable random 0..1 per LED'],
];

const STDLIB = [
  ['Maths', [
    ['PI TAU', ''], ['sin cos tan asin acos atan atan2', ''], ['abs min max floor ceil round', ''],
    ['sqrt pow exp log hypot sign', ''],
    ['clamp(v, lo=0, hi=1)', ''], ['fract(x)', 'x − floor(x)'], ['mix(a, b, t)', 'numbers or colours'],
    ['step(edge, x)', ''], ['smoothstep(e0, e1, x)', ''],
  ]],
  ['Shapes', [
    ['wave(x)', '½ + ½·sin(2πx)'], ['tri(x)', 'triangle 0..1'], ['saw(x)', 'sawtooth 0..1'],
    ['pulse(x, width)', '1 near 0, falling to 0 at ±width, wrapping'],
    ['beat(t, bpm)', 'phase 0..1'], ['dist(x1,y1,z1, x2,y2,z2)', ''],
  ]],
  ['Randomness', [
    ['hash(n)', 'stable 0..1'], ['rand(a, b?, c?)', 'stable 0..1'],
    ['noise(x, y?, z?, w?)', 'smooth 0..1'], ['fbm(x, y, z, octaves=4)', ''],
  ]],
  ['Colour', [
    ['hsv(h, s, v)', ''], ['hsl(h, s, l)', ''], ['rgb(r, g, b)', ''], ["hex('#rrggbb')", ''],
    ['scale(c, k)', ''], ['add(c1, c2)', ''], ['gradient(t, [c0, c1, …])', ''],
    ['cosPalette(t, a, b, c, d)', 'Inigo Quilez palettes'],
  ]],
];

const SKELETON = `const params = {
  speed: { value: 0.4, min: 0, max: 2 },
  color: { value: '#ff6a00', type: 'color' },
  glow:  { value: true, type: 'toggle' },
};

function frame(t, P) {}       // optional, once per frame

function pixel(p, t, P) {     // every LED, every frame
  return [r, g, b];           // 0..1 each, optional 4th = alpha
}`;

export function quickReference(onInsert) {
  const insertable = (sig) => {
    const name = sig.split('(')[0].trim();
    if (name.includes(' ')) {
      return h('span', { class: 'ref-names' }, name.split(' ').map((n) => h('button', { type: 'button', class: 'ref-name', text: n, onClick: () => onInsert(n) })));
    }
    const call = sig.includes('(') ? `${name}(` : name;
    return h('button', { type: 'button', class: 'ref-name', text: sig, title: `Insert ${call}`, onClick: () => onInsert(call) });
  };
  return h('details', { class: 'reference' },
    h('summary', { text: 'Pattern API quick reference' }),
    h('div', { class: 'ref-body' },
      h('section', {},
        h('h3', { text: 'Shape of a pattern' }),
        h('pre', { class: 'ref-code', text: SKELETON }),
        h('p', { class: 'ref-note' }, 'Colours are ', h('code', { text: '[r, g, b]' }), ' arrays, 0..1. ', h('code', { text: 'P' }),
          ' holds each param’s value; colour params arrive as ', h('code', { text: '[r, g, b]' }), '.')),
      h('section', {},
        h('h3', { text: 'The pixel p' }),
        h('dl', { class: 'ref-fields' }, FIELDS.flatMap(([k, v]) => [
          h('dt', {}, k.split(' ').map((n) => h('button', { type: 'button', class: 'ref-name', text: `p.${n}`, onClick: () => onInsert(`p.${n}`) }))),
          h('dd', { text: v }),
        ]))),
      h('section', {},
        h('h3', { text: 'Stdlib (globals)' }),
        STDLIB.map(([title, items]) => h('div', { class: 'ref-group' },
          h('h4', { text: title }),
          h('ul', { class: 'ref-list' }, items.map(([sig, note]) => h('li', {}, insertable(sig), note ? h('span', { class: 'ref-desc', text: note }) : null))))))));
}
