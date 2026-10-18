// A plain <textarea> code editor: line numbers, Tab inserts two spaces (Esc then Tab leaves the
// editor), Enter keeps indentation, Ctrl/Cmd+S saves. Below it, a quick reference of the pattern API
// (SPEC "Pattern code"): click a name to insert it.
import { h, nextId } from './dom.js';
import { ISSUE_LABELS } from './chain.js';

const INDENT = '  ';

export class CodeEditor {
  constructor(container, { onInput, onSave, label = 'Pattern code' } = {}) {
    const noop = () => {};
    Object.assign(this, { onInput: onInput || noop, onSave: onSave || noop, escaped: false, lineCount: 0,
      problemLine: 0 });
    const id = nextId('code');
    this.gutter = h('div', { class: 'gutter', 'aria-hidden': 'true' });
    this.ta = h('textarea', { id, class: 'code', spellcheck: false, wrap: 'off', autocapitalize: 'off',
      autocomplete: 'off', autocorrect: 'off', 'aria-describedby': `${id}-help ${id}-problem`, 'data-gramm': 'false' });
    this.problem = h('div', { id: `${id}-problem`, class: 'problem', role: 'status', 'aria-live': 'polite',
      hidden: true });
    const help = 'Tab inserts spaces. Press Escape, then Tab, to move focus out of the editor.';
    this.el = h('div', { class: 'editor' }, h('label', { for: id, class: 'sr-only', text: label }),
      h('div', { class: 'editor-scroll' }, this.gutter, this.ta), this.problem,
      h('p', { id: `${id}-help`, class: 'sr-only', text: help }));
    container.append(this.el);

    this.ta.addEventListener('input', () => { this._lines(); this.onInput(this.ta.value); });
    this.ta.addEventListener('scroll', () => { this.gutter.scrollTop = this.ta.scrollTop; });
    this.ta.addEventListener('keydown', (e) => this._key(e));
    this.ta.addEventListener('blur', () => { this.escaped = false; });
  }

  get value() { return this.ta.value; }

  setValue(code) {
    if (this.ta.value !== code) {
      this.ta.value = code;
      this.ta.scrollTop = 0;
      this.ta.scrollLeft = 0;
    }
    this._lines();
  }

  setDisabled(disabled, placeholder = '') { Object.assign(this.ta, { disabled, placeholder }); }
  focus() { this.ta.focus(); }

  /** problem: null | { kind: 'compile'|'runtime'|'hung', message, line? } */
  setProblem(problem) {
    const line = problem ? (problem.line || findLine(problem.message)) : 0;
    this.problem.hidden = !problem;
    this.problem.replaceChildren();
    if (problem) {
      this.problem.dataset.kind = problem.kind;
      const label = ISSUE_LABELS[problem.kind] || 'Problem';
      const msg = problem.message || '';
      const where = line && !/\bline \d+/i.test(msg) ? ` (line ${line})` : '';
      const note = ' — the model keeps showing the last version that worked.';
      this.problem.append(h('strong', { text: `${label}${where}: ` }), h('span', { text: msg }),
        problem.running ? h('span', { class: 'problem-note', text: note }) : '');
    }
    if (line !== this.problemLine) { this.problemLine = line; this._markLine(); }
  }

  /** Insert text at the cursor (used by the quick reference). */
  insert(text) { this.ta.focus(); insertText(this.ta, text); }

  _lines() {
    const n = (this.ta.value.match(/\n/g) || []).length + 1;
    if (n === this.lineCount) return;
    this.lineCount = n;
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= n; i++) frag.append(h('div', { text: String(i) }));
    this.gutter.replaceChildren(frag);
    this._markLine();
  }

  _markLine() {
    for (const el of this.gutter.querySelectorAll('.err')) el.classList.remove('err');
    if (this.problemLine && this.gutter.children[this.problemLine - 1]) {
      this.gutter.children[this.problemLine - 1].classList.add('err');
    }
  }

  _key(e) {
    const ta = this.ta;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.onSave(); return; }
    if (e.key === 'Escape') { this.escaped = true; return; }
    if (e.key === 'Tab') {
      if (this.escaped || e.ctrlKey || e.altKey || e.metaKey) { this.escaped = false; return; } // focus moves on
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end, value } = ta;
      const multi = value.slice(s, end).includes('\n');
      if (!multi && !e.shiftKey) { insertText(ta, INDENT); return; }
      // indent / outdent every selected line
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const out = value.slice(lineStart, end).split('\n')
        .map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : INDENT + l)).join('\n');
      ta.setSelectionRange(lineStart, end);
      insertText(ta, out);
      ta.setSelectionRange(lineStart, lineStart + out.length);
      return;
    }
    this.escaped = false;
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      const { selectionStart: s, value } = ta;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(lineStart, s))[0];
      const before = value.slice(lineStart, s).trimEnd();
      const extra = /[{([]$/.test(before) ? INDENT : '';
      if (indent || extra) { e.preventDefault(); insertText(ta, '\n' + indent + extra); }
    }
  }
}

/** Insert keeping the browser's undo stack when possible. */
function insertText(ta, text) {
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Pull a line number out of an error message, if it has one. */
export function findLine(msg) {
  if (!msg) return 0;
  const m = /\bline (\d+)/i.exec(msg) || /<anonymous>:(\d+):\d+/.exec(msg)
    || /:(\d+):(\d+)\)?\s*$/.exec(msg);
  return m ? +m[1] : 0;
}

const FIELDS = [
  ['x y z', '0..1 across the whole rig (depth front → back, height, left → right)'],
  ['X Y Z', 'metres'],
  ['lx ly lz', '0..1 across the pixels this layer targets — a pattern fills what it lands on'],
  ['a r', 'angle 0..1 (clockwise from 12 o’clock, seen from the front) and radius 0..1 on the façade, round '
    + 'this layer’s centre'],
  ['u i n', 'position 0..1 along its fixture (a wire, a panel), index along it, fixture length'],
  ['zone zi fixture', 'zone name, zone index, fixture index (strand: the same)'],
  ['ring sector', 'the rig’s rings and sectors: the rose’s ring 1–7 and petal 0–15 (0 / −1 elsewhere; also row petal)'],
  ['attr(name)', 'any per-pixel number the rig defines (0 where it has none)'],
  ['is(tag)', 'true on pixels in a group tagged tag: is(\'rose\'), is(\'tower\')'],
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
    ['pal(role, t)', "the look's palette: 'low' 'body' 'accent' 'high'"], ['palette(t)', 'all of it, low to high'],
  ]],
  ['Composing', [
    ['use(name, params?)', 'a library source as (p, t) → colour; call it at the top'],
    ['G', 'the look: G.energy 0..1, G.palette, each macro as G.name'],
    ["centres('tower')", 'the middle [X, Y, Z] of each group tagged tower (in frame or pixel)'],
  ]],
];

const SKELETON = `const params = {
  speed: { value: 0.4, min: 0, max: 2 },
  color: { value: '#ff6a00', type: 'color' },
  glow:  { value: true, type: 'toggle' },
};

function frame(t, P, G) {}    // optional, once per frame

function pixel(p, t, P, G) {  // a source: every LED, every frame
  return [r, g, b];           // 0..1 each, optional 4th = alpha
}
// a warp:   function warp(q, t, P, G) { q.lz = 1 - q.lz; }
// a filter: function filter(c, q, t, P, G, x) { return c; }`;

export function quickReference(onInsert) {
  const name = (text, insert = text, title) => h('button', { type: 'button', class: 'ref-name', text, title,
    onClick: () => onInsert(insert) });
  const insertable = (sig) => {
    const n = sig.split('(')[0].trim(), call = sig.includes('(') ? `${n}(` : n;
    return n.includes(' ') ? h('span', { class: 'ref-names' }, n.split(' ').map((w) => name(w)))
      : name(sig, call, `Insert ${call}`);
  };
  return h('details', { class: 'reference' },
    h('summary', { text: 'Pattern API quick reference' }),
    h('div', { class: 'ref-body' },
      h('section', {},
        h('h3', { text: 'Shape of a pattern' }),
        h('pre', { class: 'ref-code', text: SKELETON }),
        h('p', { class: 'ref-note' }, 'Colours are ', h('code', { text: '[r, g, b]' }), ' arrays, 0..1. ',
          h('code', { text: 'P' }), ' holds each param’s value; colour params arrive as ',
          h('code', { text: '[r, g, b]' }), '.')),
      h('section', {},
        h('h3', { text: 'The pixel p' }),
        h('dl', { class: 'ref-fields' }, FIELDS.flatMap(([k, v]) => [
          h('dt', {}, k.split(' ').map((n) => name(`p.${n}`))),
          h('dd', { text: v }),
        ]))),
      h('section', {},
        h('h3', { text: 'Stdlib (globals)' }),
        STDLIB.map(([title, items]) => h('div', { class: 'ref-group' }, h('h4', { text: title }),
          h('ul', { class: 'ref-list' }, items.map(([sig, note]) => h('li', {}, insertable(sig),
            note ? h('span', { class: 'ref-desc', text: note }) : null))))))));
}
