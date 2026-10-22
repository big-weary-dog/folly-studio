// The Pi's live engine (pi/README.md): `npm run pi` from the repo root. Looks from pi/looks (and pi/local/looks), our
// library from public/patterns, the rig from public/data/rig.json; out as DDP to fppd at 40 fps, colour-corrected for
// the LEDs, the rose expanded and the power compressor applied, or with --dry-run nothing sent and a stats line
// printed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lightOf } from '../public/js/core/light.ts';
import { loadBaked } from './src/baked.ts';
import { readConfig } from './src/config.ts';
import { createEngine } from './src/engine.ts';
import { readLibrary, readLooks } from './src/library.ts';
import { createOutput } from './src/output.ts';
import { checkPixels, type PowerTable } from './src/power.ts';
import type { EngineState } from './src/protocol.ts';
import { createRelay } from './src/relay.ts';
import { runLoop } from './src/run.ts';
import { controlServer } from './src/server.ts';
import { statsLine } from './src/stats.ts';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const json = (p: string) => JSON.parse(readFileSync(at(p), 'utf8'));
const log = (line: string) => console.log(`studio-pi: ${line}`);
/** The light settings file as JSON; null when there is none (the defaults). A broken one stops the start. */
const readLight = (file: string) => {
  try { return JSON.parse(readFileSync(path.resolve(path.dirname(at('./main.ts')), file), 'utf8')); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
  }
};

const cfg = readConfig(process.argv.slice(2), at('./config.json'));
if (cfg) await main(cfg);

async function main(c: NonNullable<typeof cfg>) {
  const rig = json('../public/data/rig.json'), table: PowerTable = json('./data/power.json');
  checkPixels(rig, table);
  const lib = readLibrary(at('../public/patterns'));
  const looks = readLooks([at('./looks'), at('./local/looks'), ...(c.looks ? [path.resolve(c.looks)] : [])], lib);
  for (const [id, l] of looks) if (l.error) log(`look ${id} cannot play: ${l.error}`);
  if (!looks.get(c.safe)?.look) throw new Error(`the safe look ${c.safe} cannot play`);
  const output = createOutput({ table, power: c, dryRun: c.dryRun, host: c.host, port: c.port });
  // The light settings (SPEC "Light and output"): Studio's Light page downloads them as pi/light.json; missing, the
  // defaults. On the way out only: the engine's frames (and the Live tab's) stay the look's own.
  const light = lightOf(readLight(c.light));
  // Looks' bakes from Studio's frames folder, when it says where (SPEC-offline "Playing on the lights").
  const frames = c.frames && path.resolve(path.dirname(at('./main.ts')), c.frames);
  // Frames a browser may render for the engine (SPEC-live "Relay to the lights"), on the rig's cells.
  const relay = createRelay({ count: rig.count, fps: rig.output?.fps || 40 });
  const engine = createEngine({ rig, lib, looks: () => looks, safe: c.safe, log, light, relay,
    output: (cells) => output.send(cells), bake: (id, sha256) => loadBaked(frames, id, sha256, engine.scene) });
  // The rig's pixels must sit within the cells the expansion reads (its declared universes run past them, unused).
  const cellsEnd = Math.min(...table.petals.map((p) => p.exp));
  if (Math.max(...engine.scene.addr) + table.cellChannels > cellsEnd) throw new Error('the rig overlaps the rose');
  await output.ready;
  const to = c.dryRun ? 'DRY RUN, nothing sent' : `DDP ${c.host}:${c.port}`;
  log(`${to}, channels 1-${table.channels} (rose expanded), `
    + `rig ${rig.name} ${rig.count} px at ${engine.fps} fps, power cap ${c.cap} gen ${c.gen} W, library ${lib.hash}, `
    + `${[...looks.values()].filter((l) => l.look).length} looks, gamma ${light.gamma}`);
  engine.play(looks.get(c.look)?.look ? c.look : c.safe);

  // A dry run renders only while someone has its page open (Studio's feed is no one); the Pi always plays.
  let page: Awaited<ReturnType<typeof controlServer>> | null = null;
  const loop = runLoop(engine, engine.fps, undefined, () => c.dryRun && page?.watching() === 0);
  let cutBefore = 0;
  const every = setInterval(() => {
    const o = output.status();
    log(statsLine(engine, o, loop.fps(), o.cut - cutBefore, relay.state()));
    cutBefore = o.cut;
  }, c.stats * 1000);

  const list = [...looks].map(([id, l]) => ({ id, title: l.look?.title ?? id, playable: !!l.look,
    duration: l.look?.duration || 30,
    ...(l.error ? { error: l.error } : {}) })).sort((a, b) => a.title.localeCompare(b.title));
  const state = (): EngineState => {
    const o = output.status(), s = engine.stats;
    return { ...engine.state(), looks: list, out: { dryRun: c.dryRun, fps: loop.fps(), renderMs: s.renderMs,
      genW: o.genW, genPeakW: o.genPeakW, gen: c.gen, cut: o.cut, ddpErrors: o.errors, lastError: o.lastError },
      relay: relay.state() };
  };
  page = c.http
    ? await controlServer({ engine, lib, state, pin: c.pin, mode: c.mode, relay, port: c.http, host: c.bind,
      base: c.base, log }) : null;
  if (page) log(`control page on http://${c.bind}:${page.port}${c.base}/${c.pin ? ' (PIN set)' : ''}`);

  let stopping = false;
  const stop = async (why: string) => {
    if (stopping) return;
    stopping = true;
    log(`${why}: fading to black`);
    engine.fadeOut();
    await new Promise((r) => setTimeout(r, 1100));
    loop.stop();
    clearInterval(every);
    await page?.close();
    await output.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  if (c.seconds) setTimeout(() => void stop(`${c.seconds} s up`), c.seconds * 1000);
}
