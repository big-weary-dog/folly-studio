// Looks from before the one rule, when a warp bent the modules after it (and on through blurs and trails), converted
// so they render as they did (SPEC "Looks" > chain). Pure: it reads module code as text, never runs it.
//
// Old: module i reads the pixel bent by every warp before it, the first applied first. New (warps.ts): by the warps
// below it up to the next stage end, the bottom-most first. So a run of modules that read the same warps stays in
// order with those warps after it, reversed, and is exact to the bit: the same warps run in the same order on the same
// fields. A stage that needs two runs, bent differently, is split by a warp stop (a blur of radius 0: the stage buffer
// carries c unclamped, exact) or, with two visible sources only, turned over (below). A stage after a stage end gets
// copies of the warps it read. Over 8 modules, the warps stay in their stage, bending all of it, and a note says so.
import { MAX_LAYER_CODE_BYTES, MAX_MODULES, type Module } from './schemas/look.ts';
import { isStageEnd } from '../public/js/pattern-core.ts';

/** A look's `chain`: its chains follow the one rule. A look without it is converted once, on its way in. */
export const CHAIN = 2;
type Mod = Partial<Module> & { kind?: Module['kind'] };
type Layer = { title?: string, id?: string, modules?: unknown };

const CODE_ONLY = /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
/** The pixel fields that parameter `arg` of `fn` touches in code (attr and is read k), or null: it may touch any. */
export function touches(code: unknown, fn: string, arg: number): Set<string> | null {
  if (typeof code !== 'string') return null;
  const src = code.replace(CODE_ONLY, (all, text) => text ?? ' ');
  const head = new RegExp(`\\bfunction\\s+${fn}\\s*\\(([^)]*)\\)`).exec(src);
  if (!head) return null;
  const name = head[1].split(',')[arg]?.trim() ?? '';
  if (!name) return new Set();
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const rest = src.slice(0, head.index) + src.slice(head.index + head[0].length), out = new Set<string>();
  const id = name.replace(/\$/g, '\\$');
  const use = new RegExp(`(?<![\\w$.])(\\.{1,3})?${id}(?![\\w$])(\\s*\\.\\s*([A-Za-z_$][\\w$]*))?`, 'g');
  for (const m of rest.matchAll(use)) {
    if (m[1] === '.') continue;                  // another object's property of that name
    if (m[1] || !m[3]) return null;              // spread, passed on, aliased
    out.add(m[3]);
  }
  if (out.has('attr') || out.has('is')) out.add('k');
  return out;
}

const kind = (m: Mod) => m.kind ?? 'source';
/** What an op (a source or filter) reads of the pixel; a spatial filter reads none. */
const reads = (m: Mod) => (kind(m) === 'source' ? touches(m.code, 'pixel', 0)
  : isStageEnd(m) && m.ref !== 'trails' ? new Set<string>() : touches(m.code, 'filter', 1));
const apart = (a: Set<string> | null, b: Set<string> | null) => !!a && !!b && ![...a].some((f) => b.has(f));

const STOP_CODE = `// Warp stop: a blur of radius 0 changes nothing; the warps below it bend nothing above it.
const spatial = 'blur';
const params = {
  radius: { value: 0, min: 0, max: 1.5, step: 0.01, label: 'Radius (metres; along the wire, metres of wire)' },
  mode: { value: 'wire', type: 'choice', options: ['wire', 'space', 'both'], label: 'Along the wire, in space, both' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mix with the sharp colour' },
};

function filter(c) {
  return c;
}
`;

type Op = { m: Mod, need: number };      // need: how many of the chain's warps it reads (−1: none that matter)
// A run of ops, then the chain's warps lo..hi−1 reversed (a warp stop before it when `stop`).
type Part = { ops: Mod[], lo: number, hi: number, stop: boolean };

/**
 * A chain from before the one rule → { modules, exact }: modules that render as the old chain did (exact), or, when
 * that takes more than 8 modules or a stage end read a bent pixel, each warp at the end of its stage.
 */
export function convertChain(modules: readonly Mod[]): { modules: Mod[], exact: boolean } {
  const live = modules.filter((m) => m.enabled !== false);
  const warps = live.filter((m) => kind(m) === 'warp'), bends = warps.map((w) => touches(w.code, 'warp', 0));
  // An op is free when no warp touches what it reads: any warps, or none, leave it as it was.
  const free = (m: Mod) => bends.every((b) => apart(reads(m), b));
  const stages: Op[][] = [[]], ends: Mod[] = [];
  let seen = 0, exact = true;
  for (const m of live) {
    if (kind(m) === 'warp') { seen++; continue; }
    if (!isStageEnd(m)) { stages.at(-1)!.push({ m, need: free(m) ? -1 : seen }); continue; }
    if (!bends.slice(0, seen).every((b) => apart(reads(m), b))) exact = false;   // a stage end reads the pixel
    ends.push(m);
    stages.push([]);
  }
  const parts = stages.map((ops, s) => plan(ops, s === 0));
  const built = exact && assemble(modules, live, warps, parts, ends);
  if (built && built.length <= MAX_MODULES && codeBytes(built) <= MAX_LAYER_CODE_BYTES) {
    return { modules: built, exact: true };
  }
  return { modules: inPlace(modules), exact: false };
}

/** A stage's runs: one when its ops read the same warps (or none that matter); else two turned over, or split. */
function plan(ops: Op[], first: boolean): Part[] {
  const needs = [...new Set(ops.filter((o) => o.need >= 0).map((o) => o.need))];
  if (needs.length <= 1) return [{ ops: ops.map((o) => o.m), lo: 0, hi: needs[0] ?? 0, stop: false }];
  return (first && turnOver(ops, needs)) || split(ops);
}

/**
 * Two visible sources bent differently, nothing else but hidden ones, first in the chain (c starts empty): the runs go
 * in reverse, so the second source draws first, and the first goes under it, or adds or maxes as the second did. Exact
 * to the bit: onto nothing a source is itself, and `under` of (s2 onto nothing, s1) computes (s2·a2 + s1·k) / A with
 * k = a1(1 − a2), A = a2 + k, the very operations `over` of (s1, s2) did; add and max are symmetric in theirs.
 */
function turnOver(ops: Op[], needs: number[]): Part[] | null {
  const shown = ops.filter((o) => o.m.as !== 'input');
  if (ops.some((o) => kind(o.m) !== 'source') || shown.length !== 2) return null;
  const [one, two] = shown;
  const b1 = one.m.blend ?? 'over', b2 = two.m.blend ?? 'add';
  if (one.need < 0 || two.need < 0 || one.need === two.need || b1 === 'multiply') return null;
  if (!['over', 'add', 'max'].includes(b2)) return null;
  const under = { ...one.m, blend: b2 === 'over' ? 'under' as const : b2 };
  return needs.map((need, i) => ({ lo: needs[i - 1] ?? 0, hi: need, stop: false, ops: ops
    .filter((o) => (o.need < 0 ? i === 0 : o.need === need)).map((o) => (o === one ? under : o.m)) })).reverse();
}

/** Runs split where what they read changes, a warp stop between them; free ops stay with the run before them. */
function split(ops: Op[]): Part[] {
  const parts: Part[] = [];
  for (const o of ops) {
    const last = parts.at(-1);
    if (last && (o.need < 0 || last.hi < 0 || o.need === last.hi)) {
      last.ops.push(o.m);
      if (last.hi < 0) last.hi = o.need;
    } else parts.push({ ops: [o.m], lo: 0, hi: o.need, stop: !!last });
  }
  return parts;
}

/** The new chain: each stage's runs, each followed by its warps reversed (copies after the first use), stage ends
 * between them; warps nothing reads at the top of their stage; disabled modules where they will do what they did. */
function assemble(modules: readonly Mod[], live: Mod[], warps: Mod[], stages: Part[][], ends: Mod[]) {
  const ids = new Set(modules.map((m) => m.id)), used = new Set<Mod>();
  const fresh = (id: string) => {
    let n = 2;
    while (ids.has(`${id}.${n}`.slice(-64))) n++;
    return `${id}.${n}`.slice(-64);
  };
  const take = (w: Mod) => {
    if (!used.has(w)) { used.add(w); return w; }
    const id = fresh(w.id ?? 'w');
    ids.add(id);
    return { ...w, id };
  };
  const stageOf = (m: Mod) => live.slice(0, live.indexOf(m)).filter((x) => ends.includes(x)).length;
  const runs = stages.map((parts) => parts.map((p) => [...p.ops,
    ...warps.slice(p.lo, Math.max(p.lo, p.hi)).reverse().map(take)]));
  const out: Mod[] = [];
  runs.forEach((parts, s) => {
    out.push(...warps.filter((w) => !used.has(w) && stageOf(w) === s));      // they bend nothing
    parts.forEach((run, i) => {
      if (stages[s][i].stop) {
        const id = ids.has('stop') ? fresh('stop') : 'stop';
        ids.add(id);
        out.push({ id, kind: 'filter', title: 'Warp stop', ref: 'blur', code: STOP_CODE, params: {} });
      }
      out.push(...run);
    });
    const off = modules.filter((m, i) => m.enabled === false && kind(m) === 'warp'
      && modules.slice(0, i).filter((x) => ends.includes(x)).length === s);
    out.push(...off.reverse());
    if (ends[s]) out.push(ends[s]);
  });
  // A disabled source or filter goes after the module that was before it (not counting warps).
  const at = (m: Mod) => out.findIndex((x) => x === m || (m.id !== undefined && x.id === m.id));
  modules.forEach((m, i) => {
    if (m.enabled !== false || kind(m) === 'warp') return;
    const before = modules.slice(0, i).reverse().find((x) => kind(x) !== 'warp' && at(x) >= 0);
    out.splice(before ? at(before) + 1 : 0, 0, m);
  });
  const fed = out.every((m, i) => !m.input || kind(m) !== 'filter'
    || out.slice(0, i).some((s) => s.id === m.input && kind(s) === 'source'));
  return fed ? out : null;
}

/** The inexact fallback: each warp at the end of its stage, reversed, so it bends all of the stage above it. */
function inPlace(modules: readonly Mod[]): Mod[] {
  const out: Mod[] = [];
  let warps: Mod[] = [];
  for (const m of modules) {
    if (kind(m) === 'warp') { warps.unshift(m); continue; }
    if (m.enabled !== false && isStageEnd(m)) { out.push(...warps, m); warps = []; } else out.push(m);
  }
  return [...out, ...warps];
}

const codeBytes = (mods: Mod[]) => mods.reduce((n, m) => n + new TextEncoder().encode(m.code ?? '').length, 0);

/** Layers from before the one rule, converted; a note for each that is not exact. */
export function convertLayers<L extends Layer>(layers: readonly L[]): { layers: L[], notes: string[] } {
  const notes: string[] = [];
  const out = layers.map((l) => {
    if (!l || !Array.isArray(l.modules)) return l;
    const { modules, exact } = convertChain(l.modules as Mod[]);
    if (!exact) notes.push(`layer “${l.title || l.id || '?'}”: its warps now bend all of their stage above them`);
    return { ...l, modules };
  });
  return { layers: out, notes };
}

/**
 * A look as the one rule reads it: one without `chain: 2` has its layers converted and is marked, and its summary says
 * which layers could not keep their look exactly (`exact` false). A marked look is returned as it is.
 */
export function upgradeLook<T extends { layers?: unknown, summary?: string | null, chain?: unknown }>(look: T) {
  if (look.chain === CHAIN || !Array.isArray(look.layers)) return { look: { ...look, chain: CHAIN }, exact: true };
  const { layers, notes } = convertLayers(look.layers as Layer[]);
  const note = notes.length ? ` Warps now bend what is above them: ${notes.join('; ')}.` : '';
  const said = !note || (look.summary ?? '').includes(note.trim());
  return { look: { ...look, layers, chain: CHAIN, ...(said ? {} : { summary: `${look.summary ?? ''}${note}`.trim()
    .slice(0, 2000) }) }, exact: !notes.length };
}
