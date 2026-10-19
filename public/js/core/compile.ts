// Compiling pattern and module source: the stdlib (and use()) as locals, browser globals shadowed, readable
// errors; and the library that use() runs.
import { type G, resolveParams, type Values } from './globals.ts';
import type { ModuleKind, Pixel } from './render.ts';
import { clamp, hex, isNum, RUN, STDLIB, STDLIB_NAMES } from './stdlib.ts';

/** A pattern's params as its controls show them (SPEC "Pattern code"). */
export type ParamSpec = { label?: string } & ({ type: 'number', value: number, min: number, max: number, step?: number }
  | { type: 'toggle', value: boolean } | { type: 'color', value: string }
  | { type: 'choice', value: string, options: string[] });
export type ParamSchema = Record<string, ParamSpec>;
type RGBA = number[];
/** What each kind defines (SPEC "Modules"); a module compiled: its function, `frame`, params, and for a spatial
 * filter its op (SPEC "Spatial modules"). */
export type Compiled = { kind: ModuleKind, params: ParamSchema, frame?: (t: number, P: Values, G: G) => void,
  spatial?: (typeof SPATIAL_OPS)[number],
  pixel?: (p: Pixel, t: number, P: Values, G: G) => unknown, warp?: (q: Pixel, t: number, P: Values, G: G) => void,
  filter?: (c: RGBA, q: Pixel, t: number, P: Values, G: G, x?: RGBA) => unknown };

// Browser globals hidden from pattern code as undefined locals: defence in depth (the sandbox is the boundary).
const SHADOWED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'self', 'window',
  'globalThis', 'document', 'parent', 'top', 'opener', 'frames', 'postMessage', 'location',
  'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'Worker', 'SharedWorker',
  'BroadcastChannel', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask',
];
const SCOPE = Object.freeze({ ...STDLIB, use });
const SPATIAL_OPS = Object.freeze(['blur'] as const);   // what `const spatial = …` may name (SPEC "Spatial modules")
const CHOICE = /^[a-z][a-z0-9-]{0,31}$/;
const PRELUDE =
  '"use strict";\n' +
  `const { ${[...STDLIB_NAMES, 'use'].join(', ')} } = __stdlib;\n` +
  `const ${SHADOWED.map((n) => `${n} = undefined`).join(', ')};\n` +
  'return (function () {\n';
const EPILOGUE =
  '\n;return { pixel: typeof pixel === "function" ? pixel : undefined,' +
  ' warp: typeof warp === "function" ? warp : undefined, filter: typeof filter === "function" ? filter : undefined,' +
  ' frame: typeof frame === "function" ? frame : undefined,' +
  ' spatial: typeof spatial === "string" ? spatial : undefined,' +
  ' params: typeof params === "undefined" ? undefined : params };\n})();';

// Where pattern line 1 lands in the generated function, probed once, so errors say "line N" in every engine.
let lineOffset: number | null | undefined;
const STACK_LINE = /(?:<anonymous>|> (?:Function|eval)):(\d+):\d+/;
function patternLine(err: unknown) {
  if (lineOffset === undefined) {
    lineOffset = null;
    try {
      new Function('__stdlib', PRELUDE + 'throw new Error("probe");' + EPILOGUE)(SCOPE);
    } catch (e) {
      const m = STACK_LINE.exec(String((e as Error)?.stack));
      if (m) lineOffset = +m[1]! - 1;
    }
  }
  const m = lineOffset === null ? null : STACK_LINE.exec(String((err as Error)?.stack));
  const line = m ? +m[1]! - lineOffset! : 0;
  return line > 0 ? line : 0;
}

/** A pattern error as one line: "TypeError: … (line 12)". */
export function describeError(err: unknown) {
  if (err === undefined || err === null) return 'Error';
  if (typeof err !== 'object') return String(err);
  const { name = 'Error', message } = err as Partial<Error>;
  const msg = message ? `${name || 'Error'}: ${message}` : name || 'Error';
  const line = patternLine(err);
  return line ? `${msg} (line ${line})` : msg;
}

function toHexString(c: readonly unknown[]) {
  const h = (v: unknown) => Math.round(clamp(Number(v) || 0) * 255).toString(16).padStart(2, '0');
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}

/** A pattern's `params` as a JSON-safe schema: { name: { type, value, min?, max?, step?, label? } }. */
export function normalizeParams(raw: unknown): ParamSchema {
  const out: ParamSchema = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('params must be an object of { value, ... }');
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const d = (typeof v === 'number' ? { value: v } : typeof v === 'boolean' ? { value: v, type: 'toggle' }
      : typeof v === 'string' ? { value: v, type: 'color' } : v) as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') throw new Error(`param "${key}" must be { value, ... }`);
    let type = String(d.type || '').toLowerCase();
    if (type === 'colour') type = 'color';
    if (type === 'bool' || type === 'boolean' || type === 'checkbox') type = 'toggle';
    if (!type || type === 'range' || type === 'slider') {
      type = typeof d.value === 'boolean' ? 'toggle'
        : typeof d.value === 'string' || Array.isArray(d.value) ? 'color' : 'number';
    }
    let p: ParamSpec;
    if (type === 'color') {
      const c = Array.isArray(d.value) ? d.value : hex(d.value === undefined ? '#ffffff' : d.value as string);
      p = { type, value: toHexString(c) };
    } else if (type === 'toggle') {
      p = { type, value: !!d.value };
    } else if (type === 'choice') {
      const options = (Array.isArray(d.options) ? d.options : [])
        .filter((o): o is string => typeof o === 'string' && CHOICE.test(o)).slice(0, 16);
      if (!options.length) throw new Error(`param "${key}": a choice needs options, short lowercase names`);
      p = { type, value: options.find((o) => o === d.value) ?? options[0], options };
    } else if (type === 'number') {
      const value = d.value === undefined ? 0 : Number(d.value);
      if (!Number.isFinite(value)) throw new Error(`param "${key}": value must be a number`);
      p = { type, value, min: isNum(d.min) ? d.min : Math.min(0, value),
        max: isNum(d.max) ? d.max : Math.max(1, value) };
      if (isNum(d.step) && d.step > 0) p.step = d.step;
    } else {
      throw new Error(`param "${key}": unknown type "${d.type}" (number, toggle, color or choice)`);
    }
    if (typeof d.label === 'string') p.label = d.label;
    out[key] = p;
  }
  return out;
}

const syntax = (...args: string[]) => {
  try {
    return new Function(...args);
  } catch (e) {
    throw new Error(`Syntax error: ${(e as Error)?.message || e}`, { cause: e });
  }
};

// The function each kind defines, as its error messages name it.
const KINDS: Record<string, [keyof Compiled, string]> = { source: ['pixel', 'pixel(p, t, P)'],
  warp: ['warp', 'warp(q, t, P, G)'], filter: ['filter', 'filter(c, q, t, P, G, x)'] };
const FACTORIES = new Map<string, Function>(); // source → its compiled wrapper; each call makes a fresh instance

/** A module's source → a fresh instance (own top-level state) of its kind's function; throws a readable Error. */
export function compileModule(code: string | undefined, kind: string = 'source'): Compiled {
  const k = KINDS[kind];
  if (!k) throw new Error(`unknown module kind "${kind}" (source, warp or filter)`);
  const what = kind === 'source' ? 'pattern' : kind;
  if (typeof code !== 'string' || !code.trim()) throw new Error(`${what} is empty: define function ${k[1]}`);
  // Patterns are plain scripts, but forgive `export function pixel` and the like (same lines).
  code = code.replace(/^([ \t]*)export[ \t]+(?=(?:async[ \t]+)?function\b|const\b|let\b|var\b|class\b)/gm, '$1');
  let factory = FACTORIES.get(code);
  if (!factory) {
    // Parse the code on its own first: clean syntax messages, and the code cannot close our wrapper.
    syntax('"use strict";\n' + code);
    factory = syntax('__stdlib', PRELUDE + code + EPILOGUE);
    if (FACTORIES.size >= 64) FACTORIES.delete(FACTORIES.keys().next().value!);
    FACTORIES.set(code, factory);
  }
  let made: Record<string, unknown>;
  try {
    made = factory(SCOPE);
  } catch (e) {
    throw new Error(`Error while loading the ${what}: ${describeError(e)}`, { cause: e });
  }
  if (!made || typeof made[k[0]] !== 'function') throw new Error(`${what} defines no function ${k[1]}`);
  const spatial = kind === 'filter' ? made.spatial : undefined;
  if (spatial !== undefined && !SPATIAL_OPS.includes(spatial as never)) {
    throw new Error(`spatial must be ${SPATIAL_OPS.map((o) => `'${o}'`).join(' or ')}`);
  }
  return { kind, [k[0]]: made[k[0]], frame: made.frame, params: normalizeParams(made.params),
    ...(spatial ? { spatial } : {}) } as Compiled;
}

/** Compile pattern source (a source module) → { pixel, frame, params }. */
export const compilePattern = (code: string) => compileModule(code, 'source');

const LIBRARY = new Map<string, string>();         // name → source code, for use()

/** The library sources use() can run: [{ name, code }] (the app's /api/library, the render box's mount). */
export function setLibrary(list?: readonly { name: string, code: string, kind?: string }[] | null) {
  LIBRARY.clear();
  for (const e of list ?? []) if ((e.kind ?? 'source') === 'source') LIBRARY.set(e.name, e.code);
}

/** use(name, params?): library source `name` as its own instance, a function (p, t) → colour. */
function use(name: string, params?: Record<string, unknown>) {
  const code = LIBRARY.get(String(name));
  if (code === undefined) throw new Error(`use(): unknown library pattern "${name}"`);
  const m = compileModule(code, 'source');
  const P = resolveParams(m.params, params);
  const pixel = m.pixel!, frame = m.frame;
  let last = NaN;
  return function used(p: Pixel, t: number) {
    if (frame && t !== last) { last = t; frame(t, P, RUN.G!); }
    return pixel(p, t, P, RUN.G!);
  };
}
