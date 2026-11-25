// The looks the output guard (tools/output-bytes.ts) hashes and the bake bench (tools/bake-bench.ts) bakes: the
// library's. `library`: every source alone, every preset as the Studio adds it, and two busy stacks. `chains`: every
// source, filter and warp in a chain that a moving warp bends, and each without one, each source also on every LED
// direction it offers (a warp leaves those fields due: what the core settles). A look's modules name library entries
// by `ref`, their code always the library's.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_SOFTEN } from '../core/spatial.ts';
import { compileModule, type LayerInput, upgradeGlobals } from '../core/pattern-core.ts';
import { type Automation, automationFor, Bpm, Duration, Globals } from '../shared/schemas/look.ts';

type Entry = { name: string, kind: string, code: string };
/** A look of library modules by ref. */
type BenchLook = { id: string, title: string, duration?: number, bpm?: number, globals?: Globals | null,
  automation?: Automation | null, layers: LayerInput[] };

const here = (p: string) => new URL(p, import.meta.url);

/** public/patterns' modules (sources, warps, filters) by name. */
function readLibrary(dir: string) {
  const list: { name: string, kind?: string }[] = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const entries = new Map<string, Entry>();
  for (const { name, kind = 'source' } of list) {
    if (!['source', 'warp', 'filter'].includes(kind)) continue;
    entries.set(name, { name, kind, code: readFileSync(path.join(dir, `${name}.js`), 'utf8') });
  }
  return { entries };
}
export const lib = readLibrary(here('../public/patterns').pathname);

/** The look with each module's code from the library by its ref, and its globals, automation, duration and tempo
 * checked as Studio checks them; throws, saying what, if a module is not the library's. */
export function resolveLook(look: BenchLook): BenchLook {
  const layers = look.layers.map((l, i) => ({ ...l, id: l.id ?? `l${i + 1}`, modules: (l.modules ?? []).map((m, j) => {
    const e = typeof m.ref === 'string' ? lib.entries.get(m.ref) : undefined;
    if (!e) throw new Error(`layer ${i + 1}, module ${j + 1}: no library module ${m.ref}`);
    return { ...m, id: m.id ?? `m${j + 1}`, kind: e.kind, code: e.code } as typeof m;
  }) }));
  const now = upgradeGlobals(look);    // looks from before: energy a macro, the old globals gone
  const globals = Globals.nullable().parse(now.globals ?? null);
  return { ...look, layers, globals, automation: automationFor(globals).parse(now.automation ?? null),
    duration: Duration.parse(look.duration ?? 30), bpm: Bpm.parse(look.bpm ?? null) ?? undefined };
}

type IndexEntry = { name: string, kind?: string, hidden?: boolean, layers?: BenchLook['layers'],
  globals?: BenchLook['globals'] };
const index: IndexEntry[] = JSON.parse(readFileSync(here('../public/patterns/index.json'), 'utf8'));
const of = (kind: string) => index.filter((e) => (e.kind ?? 'source') === kind && !e.hidden);
const one = (id: string, modules: BenchLook['layers'][number]['modules']) => ({ id, title: id, layers: [{ modules }] });

/** Every library look; presets softened as the Studio adds them unless `noSoften`. */
export function libraryLooks(noSoften = false): BenchLook[] {
  const looks: BenchLook[] = of('source').map((e) => one(e.name, [{ ref: e.name }]));
  for (const p of of('preset')) {
    // As the Studio adds it (ui/studio/model.ts presetLayers): add at full level, softened unless it says.
    const layers = p.layers!.map((l) => ({ blend: 'add', level: 1, ...l,
      soften: noSoften ? undefined : (l.soften ?? { ...DEFAULT_SOFTEN }) }));
    looks.push({ id: `preset:${p.name}`, title: p.name, layers, globals: p.globals ?? null });
  }
  // Stacks: what a busy show layers up.
  const stack = (...ids: string[]) => ({ id: `stack:${ids.join('+')}`, title: 'stack',
    layers: ids.flatMap((id) => (looks.find((l) => l.id === id || l.id === `preset:${id}`)!.layers)) });
  looks.push(stack('plasma', 'rain', 'rose-chase'), stack('aurora', 'fireflies', 'sparkle', 'bars'));
  return looks;
}

const LED_DIRECTIONS = ['along', 'petal', 'ring'];
const MOVER = { ref: 'turbulence', params: { amount: 0.6, size: 0.3, speed: 0.3 } };

/** Every source, filter and warp in a chain a moving warp bends (chains list top to bottom). */
export function chainLooks(): BenchLook[] {
  const looks: BenchLook[] = [];
  for (const e of of('source')) {
    const params = compileModule(lib.entries.get(e.name)!.code, 'source').params;
    const variants: [string, Record<string, string>][] = [['', {}]];
    for (const [name, spec] of Object.entries(params)) {
      if (spec.type !== 'choice') continue;
      for (const d of LED_DIRECTIONS) if (spec.options.includes(d)) variants.push([`:${name}=${d}`, { [name]: d }]);
    }
    for (const [tag, p] of variants) {
      looks.push(one(`chain:${e.name}${tag}`, [{ ref: e.name, params: p }]));
      looks.push(one(`chain:${e.name}${tag}/warp`, [{ ref: e.name, params: p }, MOVER]));
    }
  }
  // Under a filter and a warp: bars along each strand, which reads the LED fields a warp leaves due.
  const BARS = { ref: 'bars', params: { direction: 'along' } };
  for (const e of of('filter')) {
    looks.push(one(`chain:${e.name}`, [BARS, { ref: e.name }]));
    looks.push(one(`chain:${e.name}/warp`, [BARS, { ref: e.name }, MOVER]));
    looks.push(one(`chain:${e.name}/warp-above`, [BARS, MOVER, { ref: e.name }]));
  }
  for (const e of of('warp')) {
    looks.push(one(`chain:${e.name}`, [BARS, { ref: e.name }]));
    looks.push(one(`chain:${e.name}/warp`, [BARS, { ref: e.name }, MOVER]));
  }
  return looks;
}
