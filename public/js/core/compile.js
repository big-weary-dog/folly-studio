// Compiling pattern source: the stdlib as locals, browser globals shadowed, readable errors.
import { clamp, hex, isNum, STDLIB, STDLIB_NAMES } from './stdlib.js';

// Browser/worker globals hidden from pattern code as undefined locals. Defence in depth only:
// the sandboxed, network-less iframe is the real boundary.
const SHADOWED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'self', 'window',
  'globalThis', 'document', 'parent', 'top', 'opener', 'frames', 'postMessage', 'location',
  'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'Worker', 'SharedWorker',
  'BroadcastChannel', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask',
];
const PRELUDE =
  '"use strict";\n' +
  `const { ${STDLIB_NAMES.join(', ')} } = __stdlib;\n` +
  `const ${SHADOWED.map((n) => `${n} = undefined`).join(', ')};\n` +
  'return (function () {\n';
const EPILOGUE =
  '\n;return { pixel: typeof pixel === "function" ? pixel : undefined,' +
  ' frame: typeof frame === "function" ? frame : undefined,' +
  ' params: typeof params === "undefined" ? undefined : params };\n})();';

// Where pattern line 1 lands in the generated function, learnt once from a probe so runtime
// errors can say "line N" in V8 and Firefox alike.
let lineOffset;
const STACK_LINE = /(?:<anonymous>|> (?:Function|eval)):(\d+):\d+/;
function patternLine(err) {
  if (lineOffset === undefined) {
    lineOffset = null;
    try {
      new Function('__stdlib', PRELUDE + 'throw new Error("probe");' + EPILOGUE)(STDLIB);
    } catch (e) {
      const m = STACK_LINE.exec(String(e && e.stack));
      if (m) lineOffset = +m[1] - 1;
    }
  }
  const m = lineOffset === null ? null : STACK_LINE.exec(String(err && err.stack));
  const line = m ? +m[1] - lineOffset : 0;
  return line > 0 ? line : 0;
}

/** A pattern error as one line: "TypeError: … (line 12)". */
export function describeError(err) {
  if (err === undefined || err === null) return 'Error';
  if (typeof err !== 'object') return String(err);
  const name = err.name || 'Error';
  const msg = err.message ? `${name}: ${err.message}` : name;
  const line = patternLine(err);
  return line ? `${msg} (line ${line})` : msg;
}

function toHexString(c) {
  const h = (v) => Math.round(clamp(+v || 0) * 255).toString(16).padStart(2, '0');
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}

/** A pattern's `params` as a JSON-safe schema: { name: { type, value, min?, max?, step?, label? } }. */
export function normalizeParams(raw) {
  const out = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('params must be an object of { value, ... }');
  }
  for (const key of Object.keys(raw)) {
    let d = raw[key];
    if (typeof d === 'number') d = { value: d };
    else if (typeof d === 'boolean') d = { value: d, type: 'toggle' };
    else if (typeof d === 'string') d = { value: d, type: 'color' };
    if (!d || typeof d !== 'object') throw new Error(`param "${key}" must be { value, ... }`);
    let type = String(d.type || '').toLowerCase();
    if (type === 'colour') type = 'color';
    if (type === 'bool' || type === 'boolean' || type === 'checkbox') type = 'toggle';
    if (!type || type === 'range' || type === 'slider') {
      type = typeof d.value === 'boolean' ? 'toggle'
        : typeof d.value === 'string' || Array.isArray(d.value) ? 'color' : 'number';
    }
    let p;
    if (type === 'color') {
      const c = Array.isArray(d.value) ? d.value : hex(d.value === undefined ? '#ffffff' : d.value);
      p = { type, value: toHexString(c) };
    } else if (type === 'toggle') {
      p = { type, value: !!d.value };
    } else if (type === 'number') {
      const value = d.value === undefined ? 0 : +d.value;
      if (!Number.isFinite(value)) throw new Error(`param "${key}": value must be a number`);
      p = { type, value, min: isNum(d.min) ? d.min : Math.min(0, value),
        max: isNum(d.max) ? d.max : Math.max(1, value) };
      if (isNum(d.step) && d.step > 0) p.step = d.step;
    } else {
      throw new Error(`param "${key}": unknown type "${d.type}" (number, toggle or color)`);
    }
    if (typeof d.label === 'string') p.label = d.label;
    out[key] = p;
  }
  return out;
}

const syntax = (...args) => {
  try {
    return new Function(...args);
  } catch (e) {
    throw new Error(`Syntax error: ${e && e.message ? e.message : e}`);
  }
};

/**
 * Compile pattern source (a script defining `pixel`, optionally `params` and `frame`), the stdlib in
 * scope as locals. Throws a readable Error on a syntax error, a top-level exception, bad params or no pixel.
 */
export function compilePattern(code) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('pattern is empty: define function pixel(p, t, P)');
  // Patterns are plain scripts, but forgive `export function pixel` and the like (same lines).
  code = code.replace(/^([ \t]*)export[ \t]+(?=(?:async[ \t]+)?function\b|const\b|let\b|var\b|class\b)/gm, '$1');
  // Parse the code on its own first: clean syntax messages, and the code cannot close our wrapper.
  syntax('"use strict";\n' + code);
  const factory = syntax('__stdlib', PRELUDE + code + EPILOGUE);
  let made;
  try {
    made = factory(STDLIB);
  } catch (e) {
    throw new Error(`Error while loading the pattern: ${describeError(e)}`);
  }
  if (!made || typeof made.pixel !== 'function') throw new Error('pattern defines no function pixel(p, t, P)');
  return { pixel: made.pixel, frame: made.frame, params: normalizeParams(made.params) };
}
