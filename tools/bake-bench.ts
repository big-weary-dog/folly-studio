#!/usr/bin/env node
// How long a bake takes here: bakes looks from pi/looks (our own library, by ref) in the real render box, with the
// limits the server would give it under STUDIO_PROFILE (the Pi's: nice 19, 384 MB), one after another as the server
// does. Needs bubblewrap; says why not when the box cannot run.
//
//   npm run bake-bench -- [--seconds 30] [--profile pi] [safe fire heartbeat-plasma]
//
// Per look: the seconds baked, the wall time, seconds of bake per second of look, and frames baked per second.
import { readFileSync } from 'node:fs';

import { readLibrary, resolveLook } from '../pi/src/library.ts';
import { configOf } from '../src/config.ts';
import { boxDefaults, type Profile } from '../src/profile.ts';
import { createRenderBox } from '../src/render-box.ts';

const FPS = 40;
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1]! : fallback;
};
const seconds = Number(flag('--seconds', '30'));
const profile = flag('--profile', 'pi') as Profile;
const looks = args.length ? args : ['safe', 'fire', 'heartbeat-plasma'];
const here = (p: string) => new URL(p, import.meta.url).pathname;

const lib = readLibrary(here('../public/patterns'));
const config = configOf(process.env);
const limits = boxDefaults(profile, config);
const box = createRenderBox({ config, ...limits, seconds, log: { warn: (...a: unknown[]) => console.error(...a) } });
const probe = await box.probe();
if (!probe.ok) {
  console.error(`The render box cannot run here: ${probe.reason}`);
  process.exit(1);
}
console.log(`profile ${profile}: nice ${box.config.nice}, memory ${Math.round(box.config.memoryBytes / 1024 ** 2)} MB`);
console.log('look                 secs   wall s   s per s   frames/s');
for (const id of looks) {
  const raw = JSON.parse(readFileSync(here(`../pi/looks/${id}.json`), 'utf8'));
  const look = resolveLook({ ...raw, id }, lib);
  const r = await box.render({ layers: look.layers, seconds, globals: look.globals, automation: look.automation,
    bpm: look.bpm });
  const wall = r.ms / 1000;
  console.log(`${id.padEnd(20)} ${r.seconds.toFixed(0).padStart(4)} ${wall.toFixed(2).padStart(8)} `
    + `${(wall / r.seconds).toFixed(3).padStart(9)} ${(r.seconds * FPS / wall).toFixed(0).padStart(10)}`);
}
