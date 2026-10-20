// A composition (composition.ts) → a generated look: each `use` becomes the library module's code with the params
// given, each preset its layers (as the Studio adds one: its modules' params, blends and inputs, overrides on top, its
// palette and macros where the look has none), each `ext:<name>` the extension's code. Reads index.json's entries and
// the pattern files' text only; it never runs them. What the model can fix (an unknown name, a filter's missing input,
// a picture that breaks its rules) is an error with a path, for the repair round; a param out of range, unknown or of
// the wrong type is mended or dropped with a note. A layer or module given as code (the old shape) passes through to
// validateLook as it was.

import { pictureProblem } from '../../public/js/pattern-core.ts';
import type { Catalog, ParamDecl } from './catalog.ts';

export type ExpandError = { path: string, code: string, message: string };
export type Uses = { library: number, extensions: number, code: number };
type Obj = Record<string, unknown>;
type Mod = { id: string, kind: string, title: string, ref?: string, code: string, params: Obj, blend?: unknown,
  input?: string, as?: unknown };

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const FN: Record<string, string> = { source: 'pixel', warp: 'warp', filter: 'filter' };
const EXT = /^ext:(.+)$/;

/** Edit distance, for "did you mean". */
function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length]!;
}
const nearest = (name: string, names: Iterable<string>) => {
  const best = [...names].map((n) => [n, distance(name, n)] as const).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= Math.max(2, name.length / 3) ? ` (did you mean ${best[0]}?)` : '';
};

/** Params as an object: from the wire's [{ name, value }] list, or an object as given. */
function paramsOf(v: unknown): Obj {
  if (Array.isArray(v)) {
    return Object.fromEntries(v.filter((p) => isObj(p) && typeof p.name === 'string').map((p) => [p.name, p.value]));
  }
  return isObj(v) ? { ...v } : {};
}

/** A picture as the core reads it: the wire's key list, [{ char, colour }], made an object. */
function pictureOf(v: unknown) {
  if (!isObj(v) || !Array.isArray(v.key)) return v;
  return { ...v, key: Object.fromEntries(v.key.filter(isObj).map((k) => [String(k.char), k.colour])) };
}

/** One param held to its declaration: the value to keep, or undefined (noted) to fall back to the default. */
function checkParam(d: ParamDecl, v: unknown, at: string, notes: string[]) {
  if (isObj(v) && typeof v.mod === 'string') return d.type === 'number' ? v : (notes.push(`${at}: a binding on a ${
    d.type} param`), undefined);
  if (d.type === 'number') {
    const n = typeof v === 'string' && v.trim() ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return (notes.push(`${at}: not a number`), undefined);
    const held = Math.min(d.max, Math.max(d.min, n));
    if (held !== n) notes.push(`${at}: ${n} held to ${d.min}..${d.max}`);
    return held;
  }
  if (d.type === 'toggle') {
    if (typeof v === 'boolean') return v;
    return v === 'true' || v === 'false' ? v === 'true' : (notes.push(`${at}: not on or off`), undefined);
  }
  if (d.type === 'choice') {
    return d.options.includes(String(v)) ? String(v) : (notes.push(`${at}: ${String(v).slice(0, 30)} is not one of ${
      d.options.join(' ')}`), undefined);
  }
  if (d.type === 'picture') return v;   // fromLibrary refused a bad one
  return typeof v === 'string' || isObj(v) ? v : (notes.push(`${at}: not a colour pick`), undefined);
}

/** Expand a composition. `look` is a generated look for validateLook; `errors` what a repair round should fix. */
export function expand(answer: unknown, catalog: Catalog) {
  const errors: ExpandError[] = [], notes: string[] = [], uses: Uses = { library: 0, extensions: 0, code: 0 };
  const a: Obj = isObj(answer) ? structuredClone(answer) : {}; // the answer stays as the model wrote it, for a repair
  const fail = (path: string, code: string, message: string) => { errors.push({ path, code, message }); };
  const globals: Obj = isObj(a.globals) ? { ...a.globals } : {};

  const exts = new Map<string, Obj>();
  (Array.isArray(a.extensions) ? a.extensions : []).forEach((e, i) => {
    const at = `extensions[${i}]`;
    if (!isObj(e) || typeof e.name !== 'string' || !e.name) return fail(at, 'bad_extension', 'it needs a name');
    const fn = FN[String(e.kind)];
    if (!fn) return fail(`${at}.kind`, 'bad_extension', 'kind is source, warp or filter');
    if (!new RegExp(`\\bfunction\\s+${fn}\\s*\\(`).test(String(e.code ?? ''))) {
      return fail(`${at}.code`, 'bad_extension', `a ${e.kind} defines function ${fn}(…)`);
    }
    if (catalog.modules.has(e.name)) notes.push(`${at}: ${e.name} shadows the library's module`);
    exts.set(e.name, e);
  });

  /** A module of the library (by ref) with these params, held to its declarations. */
  function fromLibrary(ref: string, given: Obj, at: string, extra: Partial<Mod> = {}): Mod {
    const m = catalog.modules.get(ref)!, params: Obj = {};
    for (let [name, v] of Object.entries(given)) {
      const d = m.params[name];
      if (!d) {
        notes.push(`${at}.params.${name}: ${ref} has no such param${nearest(name, Object.keys(m.params))}`);
        continue;
      }
      if (d.type === 'picture') v = pictureOf(v);
      const problem = d.type === 'picture' ? pictureProblem(v) : '';
      if (problem) {
        fail(`${at}.params.${name}`, 'bad_picture', problem);
        continue;
      }
      const kept = checkParam(d, v, `${at}.params.${name}`, notes);
      if (kept !== undefined) params[name] = kept;
    }
    uses.library++;
    return { id: extra.id || ref, kind: m.kind, title: m.title || ref, ref, code: m.code, params,
      ...(extra.blend ? { blend: extra.blend } : {}), ...(extra.input ? { input: extra.input } : {}),
      ...(extra.as ? { as: extra.as } : {}) };
  }

  /** A chain's module from a `use` (library or extension); a module given as code passes through. */
  function useModule(u: unknown, at: string): Mod | Obj | null {
    if (!isObj(u)) return (fail(at, 'bad_module', 'a module is { use, params }'), null);
    const extra = { id: typeof u.id === 'string' ? u.id : undefined, blend: u.blend,
      input: typeof u.input === 'string' ? u.input : undefined, as: u.as };
    if (typeof u.use !== 'string' || !u.use) {
      if (typeof u.code === 'string') return (uses.code++, u);
      return (fail(`${at}.use`, 'unknown_module', 'use names a library module or ext:<name>'), null);
    }
    const ext = EXT.exec(u.use)?.[1];
    if (ext !== undefined) {
      const e = exts.get(ext);
      if (!e) {
        return (fail(`${at}.use`, 'unknown_extension', `no extension named ${ext}${nearest(ext, exts.keys())}`), null);
      }
      uses.extensions++;
      return { id: extra.id || ext, kind: String(e.kind), title: String(e.summary || ext).slice(0, 80), code: e.code,
        params: paramsOf(u.params), ...(extra.blend ? { blend: extra.blend } : {}),
        ...(extra.input ? { input: extra.input } : {}), ...(extra.as ? { as: extra.as } : {}) };
    }
    if (!catalog.modules.has(u.use)) {
      const hint = catalog.presets.has(u.use) ? ` (${u.use} is a preset: give the layer "preset")`
        : nearest(u.use, catalog.modules.keys());
      return (fail(`${at}.use`, 'unknown_module', `${u.use} is not a library module${hint}`), null);
    }
    return fromLibrary(u.use, paramsOf(u.params), at, extra);
  }

  /** Unique ids in a chain, and each filter's input an earlier module's id; those that failed (null) dropped after, so
   * paths keep the model's indices. */
  function tidy(given: (Mod | Obj | null)[], at: string) {
    const seen = new Map<string, number>(), mods = given.filter((m) => m !== null);
    for (const m of mods) {
      const id = String(m.id || m.ref || 'm').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'm';
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      m.id = n > 1 ? `${id}-${n}` : id;
    }
    given.forEach((m, j) => {
      if (m && typeof m.input === 'string' && !given.slice(0, j).some((x) => x?.id === m.input)) {
        fail(`${at}[${j}].input`, 'bad_input', `input ${m.input} is not the id of a module above it`);
      }
    });
    return mods;
  }

  function presetLayers(l: Obj, at: string) {
    const p = catalog.presets.get(String(l.preset));
    if (!p) {
      return (fail(`${at}.preset`, 'unknown_preset', `${String(l.preset)} is not a preset${
        catalog.modules.has(String(l.preset)) ? ` (${String(l.preset)} is a module: give it in "modules")`
          : nearest(String(l.preset), catalog.presets.keys())}`), []);
    }
    const all = p.layers.flatMap((pl) => pl.modules), over = new Map<number, Obj>();
    (Array.isArray(l.overrides) ? l.overrides : []).forEach((o, j) => {
      if (!isObj(o) || typeof o.module !== 'string' || typeof o.name !== 'string') return;
      const [ref, nth = '1'] = o.module.split('#'), hits = all.flatMap((m, k) => (m.ref === ref ? [k] : []));
      const k = hits[Number(nth) - 1];
      if (k === undefined) {
        return fail(`${at}.overrides[${j}].module`, 'unknown_module', `${p.name} has no module ${o.module} (it has ${
          all.map((m) => m.ref).join(', ')})`);
      }
      over.set(k, { ...over.get(k), [o.name]: o.value });
    });
    if (isObj(p.globals)) {
      if (!globals.palette && p.globals.palette) globals.palette = p.globals.palette;
      const macros = Array.isArray(globals.macros) ? globals.macros as Obj[] : [];
      for (const [name, m] of Object.entries(p.globals.macros ?? {})) {
        if (!macros.some((x) => x.name === name)) macros.push({ name, ...m });
      }
      if (macros.length) globals.macros = macros;
    }
    let k = 0;
    return p.layers.map((pl, n) => ({ ...place(l), title: p.layers.length > 1 ? `${l.title || p.title} ${n + 1}`
      : l.title || p.title, ...(n ? { blend: pl.blend ?? 'add', level: pl.level ?? 1 } : {}),
    ...(pl.soften ? { soften: pl.soften } : {}),
    modules: tidy(pl.modules.map((m) => fromLibrary(m.ref, { ...m.params, ...over.get(k++) }, `${at}.preset`, {
      id: m.id, blend: m.blend, input: m.input, as: m.as })), `${at}.modules`) }));
  }

  const place = (l: Obj) => Object.fromEntries(['title', 'groups', 'tags', 'blend', 'level', 'clips', 'soften']
    .filter((k) => l[k] !== undefined).map((k) => [k, l[k]]));
  const layers = (Array.isArray(a.layers) ? a.layers : []).flatMap((l, i) => {
    const at = `layers[${i}]`;
    if (!isObj(l)) return (fail(at, 'bad_layer', 'a layer is an object'), []);
    if (l.preset) return presetLayers(l, at);
    if (Array.isArray(l.modules) && l.modules.length) {
      const mods = tidy(l.modules.map((u, j) => useModule(u, `${at}.modules[${j}]`)), `${at}.modules`);
      return mods.length ? [{ ...place(l), modules: mods }] : [];
    }
    if (typeof l.code === 'string') return (uses.code++, [l]);
    return (fail(at, 'empty_layer', 'a layer gives "preset" or "modules"'), []);
  });
  const look = { title: a.title, summary: a.summary, duration: a.duration, bpm: a.bpm, layers,
    ...(Object.keys(globals).length ? { globals } : {}), ...(a.automation !== undefined ? { automation: a.automation }
      : {}) };
  return { look, errors, notes, uses };
}
