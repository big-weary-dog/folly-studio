// The Pi's simulator (pi/README.md): stands in for fppd on a laptop. It takes the DDP `npm run pi` sends, checks each
// frame arrived whole (every packet, the rose's petals as their cells expand to) and within the generator's budget,
// prints a line a second, and with --png writes the rig from the front each second.
//   npm run pi:sim -- [--port 4048] [--png out.png] [--seconds S]   then, beside it, npm run pi
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { prepareScene } from '../public/js/pattern-core.ts';
import { ddpReceiver } from './src/ddp.ts';
import { frontView } from './src/png.ts';
import { COG_POWER, drawW, expandRose, type PowerTable } from './src/power.ts';

const json = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
const { values: a } = parseArgs({ strict: true, options: { port: { type: 'string' }, host: { type: 'string' },
  png: { type: 'string' }, seconds: { type: 'string' }, gen: { type: 'string' } } });
const table: PowerTable = json('./data/power.json'), scene = prepareScene(json('../public/data/rig.json'));
const gen = Number(a.gen ?? COG_POWER.gen), cellsEnd = Math.min(...table.petals.map((p) => p.exp));
const want = new Uint8Array(table.channels);
let frames = 0, torn = 0, over = 0, peakW = 0, last: Uint8Array | null = null;

const rx = ddpReceiver({ port: Number(a.port ?? 4048), host: a.host ?? '127.0.0.1', channels: table.channels,
  onFrame(fr) {
    frames++;
    // The petals must be what their cells expand to: anything else is a lost packet or a wrong expansion.
    expandRose(table, fr.subarray(0, cellsEnd), want);
    for (let i = cellsEnd; i < table.channels; i++) if (want[i] !== fr[i]) { torn++; break; }
    const w = drawW(table, fr);
    peakW = Math.max(peakW, w);
    if (w > gen + 1) over++;
    last = fr;
  } });
const port = await rx.ready;
console.log(`pi-sim: listening for DDP on ${a.host ?? '127.0.0.1'}:${port}, ${table.channels} channels, gen ${gen} W`);

let seen = 0;
const lit = () => {
  let n = 0;
  const fr = last ?? new Uint8Array(table.channels);
  for (let k = 0, a = 0; k < scene.count; k++) if (fr[a = scene.addr[k]!] || fr[a + 1] || fr[a + 2]) n++;
  return n;
};
const totals = () => `${frames} frames, ${torn} torn, ${rx.bad()} bad packets | draw peak ${peakW.toFixed(0)} W, `
  + `${over} frames over ${gen} W`;
const every = setInterval(() => {
  console.log(`pi-sim: ${frames - seen} fps, ${lit()} of ${scene.count} px lit | ${totals()}`);
  seen = frames;
  if (a.png && last) writeFileSync(a.png, frontView(scene, last));
}, 1000);

/** Stops with a last line of totals; exits 1 if any frame was torn or over the generator. */
const stop = async () => {
  clearInterval(every);
  console.log(`pi-sim: done | ${totals()}`);
  await rx.close();
  process.exit(torn || over ? 1 : 0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
if (a.seconds) setTimeout(() => void stop(), Number(a.seconds) * 1000);
