// The looks the bench (tools/live-bench.ts) plays and the output guard (tools/output-bytes.ts) hashes: the library
// as the Pi has it. `library`: every source alone, every preset as the Studio adds it, the Pi's own looks and two busy
// stacks. `chains`: every source, filter and warp in a chain that a moving warp bends, and each without one,
// each source also on every LED direction it offers (a warp leaves those fields due: what the core settles).
import { readFileSync } from 'node:fs';

import { DEFAULT_SOFTEN } from '../public/js/core/spatial.ts';
import { compileModule } from '../public/js/pattern-core.ts';
import { type PiLook, readLibrary, readLooks } from '../pi/src/library.ts';

const here = (p: string) => new URL(p, import.meta.url);
export const lib = readLibrary(here('../public/patterns').pathname);
type IndexEntry = { name: string, kind?: string, layers?: PiLook['layers'], globals?: PiLook['globals'] };
const index: IndexEntry[] = JSON.parse(readFileSync(here('../public/patterns/index.json'), 'utf8'));
const of = (kind: string) => index.filter((e) => (e.kind ?? 'source') === kind);
const one = (id: string, modules: PiLook['layers'][number]['modules']) => ({ id, title: id, layers: [{ modules }] });

/** Every library look, as the Pi would play it; presets softened as the Studio adds them unless `noSoften`. */
export function libraryLooks(noSoften = false): PiLook[] {
  const looks: PiLook[] = of('source').map((e) => one(e.name, [{ ref: e.name }]));
  for (const p of of('preset')) {
    // As the Studio adds it (ui/model.ts presetLayers): add at full level, softened unless it says.
    const layers = p.layers!.map((l) => ({ blend: 'add', level: 1, ...l,
      soften: noSoften ? undefined : (l.soften ?? { ...DEFAULT_SOFTEN }) }));
    looks.push({ id: `preset:${p.name}`, title: p.name, layers, globals: p.globals ?? null });
  }
  for (const [id, l] of readLooks([here('../pi/looks').pathname], lib)) {
    if (l.look) looks.push({ ...l.look, id: `pi:${id}` });
  }
  // Stacks: what a busy live set layers up.
  const stack = (...ids: string[]) => ({ id: `stack:${ids.join('+')}`, title: 'stack',
    layers: ids.flatMap((id) => (looks.find((l) => l.id === id || l.id === `preset:${id}`)!.layers)) });
  looks.push(stack('plasma', 'rain', 'rose-chase'), stack('aurora', 'fireflies', 'sparkle', 'bars'));
  return looks;
}

const LED_DIRECTIONS = ['along', 'petal', 'ring'];
const MOVER = { ref: 'turbulence', params: { amount: 0.6, size: 0.3, speed: 0.3 } };

/** Every source, filter and warp in a chain a moving warp bends (chains list top to bottom). */
export function chainLooks(): PiLook[] {
  const looks: PiLook[] = [];
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
