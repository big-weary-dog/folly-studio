// A plain <textarea> code editor for the selected module: line numbers, Tab inserts two spaces (Esc then Tab leaves
// the editor), Enter keeps indentation, Ctrl/Cmd+S saves (the Studio's shortcut). Edits reach the sandbox once typing
// settles. Below it, a quick reference of the pattern API (SPEC "Pattern code"): click a name to insert it.
import { useId, useLayoutEffect, useMemo, useRef } from 'preact/hooks';

import { ISSUE_LABELS } from './layer-status.ts';
import { FixButton } from './refine.tsx';
import type { Studio } from './studio-store.ts';

const INDENT = '  ';
const SETTLE_MS = 300;

/** Insert keeping the browser's undo stack when possible. */
function insertText(ta: HTMLTextAreaElement, text: string) {
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Pull a line number out of an error message, if it has one. */
export function findLine(msg?: string) {
  if (!msg) return 0;
  const m = /\bline (\d+)/i.exec(msg) || /<anonymous>:(\d+):\d+/.exec(msg) || /:(\d+):(\d+)\)?\s*$/.exec(msg);
  return m ? Number(m[1]) : 0;
}

export function CodeEditor({ st }: { st: Studio }) {
  const l = st.selected.value, m = st.module.value, code = m ? m.code : '', id = useId(), problem = st.problem.value;
  const ta = useRef<HTMLTextAreaElement>(null), gutter = useRef<HTMLDivElement>(null), escaped = useRef(false);
  const line = problem ? findLine(problem.message) : 0, lines = (code.match(/\n/g) || []).length + 1;
  useLayoutEffect(() => { if (ta.current) Object.assign(ta.current, { scrollTop: 0, scrollLeft: 0 }); }, [m?.id]);
  const numbers = useMemo(() => Array.from({ length: lines }, (_, i) =>
    <div class={i + 1 === line ? 'err' : undefined}>{i + 1}</div>), [lines, line]);

  function onKey(e: KeyboardEvent) {
    const t = e.currentTarget as HTMLTextAreaElement;
    if (e.key === 'Escape') { escaped.current = true; return; }
    if (e.key === 'Tab') {
      if (escaped.current || e.ctrlKey || e.altKey || e.metaKey) { escaped.current = false; return; } // focus moves on
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end, value } = t;
      if (!value.slice(s, end).includes('\n') && !e.shiftKey) { insertText(t, INDENT); return; }
      // indent / outdent every selected line
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const out = value.slice(lineStart, end).split('\n')
        .map((x) => (e.shiftKey ? x.replace(/^ {1,2}/, '') : INDENT + x)).join('\n');
      t.setSelectionRange(lineStart, end);
      insertText(t, out);
      t.setSelectionRange(lineStart, lineStart + out.length);
      return;
    }
    escaped.current = false;
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      const { selectionStart: s, value } = t, lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const indent = (/^[ \t]*/.exec(value.slice(lineStart, s)) as RegExpExecArray)[0];
      const extra = /[{([]$/.test(value.slice(lineStart, s).trimEnd()) ? INDENT : '';
      if (indent || extra) { e.preventDefault(); insertText(t, `\n${indent}${extra}`); }
    }
  }
  const msg = problem?.message || '', where = line && !/\bline \d+/i.test(msg) ? ` (line ${line})` : '';
  return <>
    <div class="editor">
      <label for={id} class="sr-only">Pattern code</label>
      <div class="editor-scroll">
        <div class="gutter" aria-hidden="true" ref={gutter}>{numbers}</div>
        <textarea id={id} ref={ta} class="code" spellcheck={false} wrap="off" autocapitalize="off" autocomplete="off"
          autocorrect="off" data-gramm="false" aria-describedby={`${id}-help ${id}-problem`} value={code} disabled={!m}
          placeholder={m ? '' : 'Add a layer to write code.'} onKeyDown={onKey}
          onBlur={() => { escaped.current = false; }}
          onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
          onInput={(e) => {
            const value = e.currentTarget.value;
            if (!l || !m) return;
            st.clock.typingUntil = performance.now() + SETTLE_MS;
            st.editModule(l.id, m.id, () => ({ code: value, ref: undefined }));   // hand-edited code is custom
          }} />
      </div>
      <div id={`${id}-problem`} class="problem" role="status" aria-live="polite" hidden={!problem}
        data-kind={problem?.kind}>
        {problem && <><strong>{`${ISSUE_LABELS[problem.kind] || 'Problem'}${where}: `}</strong><span>{msg}</span>
          {problem.running && <span class="problem-note">
            {' — the model keeps showing the last version that worked.'}</span>}
          {problem.kind === 'runtime' && l && <> <FixButton st={st} layer={l.title} error={msg} /></>}
        </>}</div>
      <p id={`${id}-help`} class="sr-only">
        Tab inserts spaces. Press Escape, then Tab, to move focus out of the editor.</p>
    </div>
    <QuickReference onInsert={(text) => { const t = ta.current; if (t) { t.focus(); insertText(t, text); } }} />
  </>;
}

const FIELDS = [
  ['x y z', '0..1 across the whole rig (depth front → back, height, left → right)'],
  ['X Y Z', 'metres'],
  ['lx ly lz', '0..1 across the pixels this layer targets — a pattern fills what it lands on'],
  ['a r', 'angle 0..1 (clockwise from 12 o’clock, seen from the front) and radius 0..1 on the façade, round '
    + 'this layer’s centre'],
  ['u i n', 'position 0..1 along its fixture (a wire, a panel), index along it, fixture length'],
  ['zone zi fixture', 'zone name, zone index, fixture index (strand: the same)'],
  ['ring sector', 'the rig’s rings and sectors: the rose’s ring 1–7 and petal 0–15 (0 / −1 elsewhere; also row '
    + 'petal)'],
  ['attr(name)', 'any per-pixel number the rig defines (0 where it has none)'],
  ['is(tag)', 'true on pixels in a group tagged tag: is(\'rose\'), is(\'tower\')'],
  ['k seed', 'global LED index; a stable random 0..1 per LED'],
];

const STDLIB: [string, string[][]][] = [
  ['Maths', [
    ['PI TAU', ''], ['sin cos tan asin acos atan atan2', ''], ['abs min max floor ceil round', ''],
    ['sqrt pow exp log hypot sign', ''],
    ['clamp(v, lo=0, hi=1)', ''], ['fract(x)', 'x − floor(x)'], ['mix(a, b, t)', 'numbers or colours'],
    ['step(edge, x)', ''], ['smoothstep(e0, e1, x)', ''],
  ]],
  ['Shapes', [
    ['wave(x)', '½ + ½·sin(2πx)'], ['tri(x)', 'triangle 0..1'], ['saw(x)', 'sawtooth 0..1'],
    ['pulse(x, width)', '1 near 0, falling to 0 at ±width, wrapping'],
    ['soft(edge, x, width)', 'a step with no stair: 0 → 1 smoothly over width round edge'],
    ['band(x, centre, halfWidth, softness)', '1 within halfWidth of centre, its edges soft'],
    ['beat(t, bpm)', 'phase 0..1'], ['dist(x1,y1,z1, x2,y2,z2)', ''],
    ["clock('speed')", 'how far param speed has moved things: modulate it and nothing jumps'],
  ]],
  ['Randomness', [
    ['hash(n)', 'stable 0..1'], ['rand(a, b?, c?)', 'stable 0..1'],
    ['noise(x, y?, z?, w?)', 'smooth 0..1'], ['fbm(x, y, z, octaves=4)', ''],
  ]],
  ['Colour', [
    ['hsv(h, s, v)', ''], ['hsl(h, s, l)', ''], ['rgb(r, g, b)', ''], ["hex('#rrggbb')", ''],
    ['scale(c, k)', ''], ['add(c1, c2)', ''], ['gradient(t, [c0, c1, …])', ''],
    ['cosPalette(t, a, b, c, d)', 'Inigo Quilez palettes'],
    ['pal(name, t)', "along a colour param's pick: pal('colours', t), first colour to last"],
    ['swatch(name, i)', 'its i-th colour, wrapping'], ['palette(t)', 'the palette, low to high'],
  ]],
  ['Composing', [
    ['use(name, params?)', 'a library source as (p, t) → colour; call it at the top'],
    ['G', 'the look: G.energy 0..1, G.bpm, G.palette, each macro as G.name'],
    ["centres('tower')", 'the middle [X, Y, Z] of each group tagged tower (in frame or pixel)'],
    ['extent()', 'this layer’s bounds in metres, [[X0, Y0, Z0], [X1, Y1, Z1]]'],
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
// a filter: function filter(c, q, t, P, G, x) { return c; }
// a blur:   const spatial = 'blur'; (radius, mode, amount params)`;

function QuickReference({ onInsert }: { onInsert: (text: string) => void }) {
  const name = (text: string, insert = text, title?: string) => <button type="button" class="ref-name" title={title}
    onClick={() => onInsert(insert)}>{text}</button>;
  const insertable = (sig: string) => {
    const n = sig.split('(')[0].trim(), call = sig.includes('(') ? `${n}(` : n;
    return n.includes(' ') ? <span class="ref-names">{n.split(' ').map((w) => name(w))}</span>
      : name(sig, call, `Insert ${call}`);
  };
  return (
    <details class="reference">
      <summary>Pattern API quick reference</summary>
      <div class="ref-body">
        <section><h3>Shape of a pattern</h3><pre class="ref-code">{SKELETON}</pre>
          <p class="ref-note">Colours are <code>[r, g, b]</code> arrays, 0..1. <code>P</code> holds each param’s
            value; colour params arrive as <code>[r, g, b]</code>. Every source also has a Brightness
            (<code>brightness</code>, 0..1) the Studio applies to what <code>pixel()</code> returns; declare your
            own to handle it yourself.</p></section>
        <section><h3>The pixel p</h3>
          <dl class="ref-fields">{FIELDS.map(([k, v]) => <>
            <dt>{k.split(' ').map((n) => name(`p.${n}`))}</dt><dd>{v}</dd></>)}</dl></section>
        <section><h3>Stdlib (globals)</h3>
          {STDLIB.map(([title, items]) => <div class="ref-group"><h4>{title}</h4>
            <ul class="ref-list">{items.map(([sig, note]) => <li>{insertable(sig)}
              {note && <span class="ref-desc">{note}</span>}</li>)}</ul></div>)}</section>
      </div>
    </details>);
}
