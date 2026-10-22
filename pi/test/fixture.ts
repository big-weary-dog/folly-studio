// What the Pi's tests share: the rig, the library and the shipped looks as `npm run pi` reads them, and an engine on
// them with its output kept rather than sent.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { lightOf, type Light } from '../../public/js/core/light.ts';
import { createEngine, type EngineOptions } from '../src/engine.ts';
import { type PiLook, readLibrary, readLooks, resolveLook } from '../src/library.ts';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export const LOOKS = at('../looks');
export const rig = JSON.parse(readFileSync(at('../../public/data/rig.json'), 'utf8'));
export const lib = readLibrary(at('../../public/patterns'));
export const shipped = () => readLooks([LOOKS], lib);

/** A look of one library module, `params` its params, `more` raw look fields (as a look file has them). */
export const oneModule = (id: string, ref: string, params = {}, more: Record<string, unknown> = {}) =>
  resolveLook({ id, title: id, duration: 30, layers: [{ modules: [{ ref, params }] }], ...more } as PiLook, lib);

/** An engine on the shipped looks plus `extra`, out through `light` (the defaults where unset); `frames` holds the
 * last frame's channels and `lit` their sum. */
export function engineOn(extra: PiLook[] = [], light?: Partial<Light>, bake?: EngineOptions['bake'],
  relay?: EngineOptions['relay']) {
  const looks = shipped();
  for (const l of extra) looks.set(l.id, { look: l, file: '' });
  const log: string[] = [];
  let last: Uint8Array = new Uint8Array(0), t = 0;
  const engine = createEngine({ rig, lib, looks: () => looks, safe: 'safe', log: (l) => log.push(l),
    light: lightOf(light), output: (cells) => { last = cells; }, now: () => t++, bake, relay, seed: 1 });
  return {
    engine, log, looks,
    /** Plays `secs` of frames. */
    run(secs: number) { for (let i = 0; i < Math.round(secs * engine.fps); i++) engine.tick(); },
    lit: () => last.reduce((s, v) => s + v, 0),
    /** The last frame's channels. */
    last: () => last,
  };
}
