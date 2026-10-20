// A refinement's two ends (SPEC-generators "Refine"): a saved look turned back into a composition, so the model edits
// names and values rather than code, and what changed between two compositions, in words. A module whose code is
// still its library ref's is `{ use: ref, params }` (the params its declarations name, from the catalogue); any other
// code becomes an extension. Reads code as text only; nothing here runs it.

import type { Catalog } from './catalog.ts';

type Obj = Record<string, unknown>;
type Param = { name: string, value: unknown };
type Use = { use: string, id?: string, params: Param[], blend?: string, input?: string, as?: string };
type Extension = { name: string, kind: string, summary: string, why: string, code: string };
export type Composition = { title: string, summary: string, duration?: number, globals?: Obj, automation?: unknown,
  layers: (Obj & { modules: Use[] })[], extensions?: Extension[] };

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const norm = (code: unknown) => String(code ?? '').replace(/\s+/g, ' ').trim();
const PLACE = ['title', 'groups', 'tags', 'blend', 'level', 'clips', 'soften'];

/** A stored look as a composition over `catalog`. Disabled modules are left out. */
export function decompose(look: Obj, catalog: Catalog): Composition {
  const extensions: Extension[] = [], lib = new Map([...catalog.modules].map(([n, m]) => [n, norm(m.code)]));
  const extension = (m: Obj, fallback: string) => {
    const code = String(m.code ?? ''), same = extensions.find((e) => e.code === code);
    if (same) return same.name;
    let name = String(m.ref || m.id || fallback).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || fallback;
    while (extensions.some((e) => e.name === name) || catalog.modules.has(name)) name = `${name}-x`;
    extensions.push({ name, kind: String(m.kind || 'source'), summary: String(m.title || name).slice(0, 80),
      why: 'already in the look', code });
    return name;
  };
  const use = (m: Obj, fallback: string): Use => {
    const ref = typeof m.ref === 'string' ? m.ref : '', known = ref && lib.get(ref) === norm(m.code);
    const params = Object.entries(isObj(m.params) ? m.params : {})
      .filter(([name]) => !known || name in catalog.modules.get(ref)!.params).map(([name, value]) => ({ name, value }));
    return { use: known ? ref : `ext:${extension(m, fallback)}`, ...(typeof m.id === 'string' ? { id: m.id } : {}),
      params, ...(['blend', 'input', 'as'] as const).reduce((o, k) => (typeof m[k] === 'string'
      ? { ...o, [k]: m[k] } : o), {}) };
  };
  const layers = (Array.isArray(look.layers) ? look.layers : []).filter(isObj).map((l, i) => {
    const place = Object.fromEntries(PLACE.filter((k) => l[k] != null).map((k) => [k, l[k]]));
    const mods = Array.isArray(l.modules) ? l.modules.filter((m) => isObj(m) && m.enabled !== false) as Obj[]
      : [{ id: 'm1', kind: 'source', title: l.title, code: l.code, params: l.params }];
    return { ...place, modules: mods.map((m, j) => use(m, `layer${i + 1}-${j + 1}`)) };
  });
  return { title: String(look.title ?? ''), summary: String(look.summary ?? ''),
    ...(typeof look.duration === 'number' ? { duration: look.duration } : {}),
    ...(isObj(look.globals) ? { globals: look.globals } : {}),
    ...(look.automation != null ? { automation: look.automation } : {}), layers,
    ...(extensions.length ? { extensions } : {}) };
}

const MAX_CHANGES = 24;
const show = (v: unknown) => (isObj(v) ? (v.mod ? `${v.mod}${v.rate != null ? ` ${v.rate}` : ''}` : 'a pick')
  : typeof v === 'number' ? String(+v.toFixed(3)) : String(v)).slice(0, 40);
const recipe = (l: Obj) => (l.modules as Use[]).map((m) => m.use.replace(/^ext:/, '')).join(' → ');
const nameOf = (l: Obj, i: number) => String(l.title || `Layer ${i + 1}`);

/** What changed from `a` to `b`, one line each, at most 24: layers added or removed, a layer's place, its modules,
 * each param that moved; the palette, the duration. */
export function diffCompositions(a: Composition, b: Composition): string[] {
  const out: string[] = [], same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const pa = (a.globals as Obj | undefined)?.palette, pb = (b.globals as Obj | undefined)?.palette;
  if (pb && JSON.stringify(pa) !== JSON.stringify(pb)) out.push(`palette: ${show(pa ?? 'default')} → ${show(pb)}`);
  if (b.duration !== undefined && a.duration !== b.duration) {
    out.push(`duration: ${a.duration ?? 30} → ${b.duration} s`);
  }
  const left = new Set(a.layers.keys());
  b.layers.forEach((lb, i) => {
    // The same layer: the same title, else the same recipe, else the same position.
    const match = [...left].find((j) => nameOf(a.layers[j]!, j) === nameOf(lb, i))
      ?? [...left].find((j) => recipe(a.layers[j]!) === recipe(lb)) ?? (left.has(i) ? i : undefined);
    if (match === undefined) return out.push(`+ layer ${nameOf(lb, i)} (${recipe(lb)})`);
    left.delete(match);
    const la = a.layers[match]!, name = nameOf(lb, i), was = nameOf(la, match);
    if (was !== name) out.push(`${was}: renamed ${name}`);
    for (const k of ['groups', 'tags', 'blend', 'level', 'clips', 'soften']) {
      if (!same(la[k] ?? null, lb[k] ?? null)) out.push(`${name}: ${k} ${show(Array.isArray(la[k])
        ? (la[k] as unknown[]).join(' ') || 'none' : la[k] ?? 'none')} → ${show(Array.isArray(lb[k])
        ? (lb[k] as unknown[]).join(' ') || 'none' : lb[k] ?? 'none')}`);
    }
    if (recipe(la) !== recipe(lb)) out.push(`${name}: ${recipe(la)} → ${recipe(lb)}`);
    for (const mb of lb.modules) {
      const ma = la.modules.find((m) => m.use === mb.use && (m.id ?? '') === (mb.id ?? ''))
        ?? la.modules.find((m) => m.use === mb.use);
      if (!ma) continue;
      const before = new Map(ma.params.map((p) => [p.name, p.value]));
      for (const p of mb.params) {
        if (!same(before.get(p.name), p.value)) {
          const was = before.has(p.name) ? show(before.get(p.name)) : 'default';
          out.push(`${name}: ${p.name} ${was} → ${show(p.value)}`);
        }
      }
    }
  });
  for (const j of left) out.push(`− layer ${nameOf(a.layers[j]!, j)}`);
  return out.length > MAX_CHANGES ? [...out.slice(0, MAX_CHANGES - 1), `… and ${out.length - MAX_CHANGES + 1} more`]
    : out;
}

const FIELDS = ['title', 'summary', 'code', 'params', 'modules', 'groups', 'tags', 'blend', 'level', 'clips', 'soften',
  'id', 'palette'];
/** Refined layers with what the model never saw put back from the layer each replaces (the same title, else the same
 * position): the layer's own flags (`enabled`, `solo`) and its switched-off modules, at the end of its chain. */
export function keepSwitches<L extends Obj>(before: Obj[], after: L[]): L[] {
  return after.map((l, i) => {
    const was = before.find((b) => b.title === l.title) ?? before[i];
    if (!was) return l;
    const flags = Object.fromEntries(Object.entries(was).filter(([k]) => !FIELDS.includes(k)));
    const mods = Array.isArray(l.modules) ? l.modules as Obj[] : null, ids = new Set(mods?.map((m) => m.id));
    const off = (Array.isArray(was.modules) ? was.modules as Obj[] : [])
      .filter((m) => m.enabled === false && !ids.has(m.id));
    return { ...flags, ...l, ...(mods && off.length ? { modules: [...mods, ...off].slice(0, 8) } : {}) };
  });
}
