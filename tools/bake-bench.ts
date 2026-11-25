#!/usr/bin/env node
// How long a bake takes here: bakes library looks (tools/bench-looks.ts: a source's name, or preset:<name>) in the
// real render box, with the limits the server would give it (STUDIO_BAKE_*), one after another as the server does.
// Says why not when the box cannot run.
//
//   npm run bake-bench -- [--seconds 30] [fire preset:plasma]
//
// Per look: the seconds baked, the wall time, seconds of bake per second of look, and frames baked per second.
import { configOf } from '../src/config.ts';
import { createRenderBox } from '../src/render-box.ts';
import { libraryLooks, resolveLook } from './bench-looks.ts';

const FPS = 40;
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1]! : fallback;
};
const seconds = Number(flag('--seconds', '30'));
const looks = args.length ? args : ['fire', 'preset:plasma'];
const library = new Map(libraryLooks().map((l) => [l.id, l]));

const box = createRenderBox({ config: configOf(process.env), seconds,
  log: { warn: (...a: unknown[]) => console.error(...a) } });
const probe = await box.probe();
if (!probe.ok) {
  console.error(`The render box cannot run here: ${probe.reason}`);
  process.exit(1);
}
console.log(`nice ${box.config.nice}, memory ${Math.round(box.config.memoryBytes / 1024 ** 2)} MB`);
console.log('look                 secs   wall s   s per s   frames/s');
for (const id of looks) {
  const found = library.get(id);
  if (!found) { console.error(`${id}: not a library look`); continue; }
  const look = resolveLook(found);
  const r = await box.render({ layers: look.layers, seconds, globals: look.globals, automation: look.automation,
    bpm: look.bpm });
  const wall = r.ms / 1000;
  console.log(`${id.padEnd(20)} ${r.seconds.toFixed(0).padStart(4)} ${wall.toFixed(2).padStart(8)} `
    + `${(wall / r.seconds).toFixed(3).padStart(9)} ${(r.seconds * FPS / wall).toFixed(0).padStart(10)}`);
}
