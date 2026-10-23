// The Pi's live engine (pi/README.md): `npm run pi` from the repo root. Looks from pi/looks (and pi/local/looks), our
// library from public/patterns, the rig from public/data/rig.json; out as DDP to fppd at 40 fps, colour-corrected for
// the LEDs, the rose expanded and the power compressor applied, or with --dry-run nothing sent and a stats line
// printed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBaked } from './src/baked.ts';
import { readConfig } from './src/config.ts';
import { createEngine } from './src/engine.ts';
import { readLibrary, readLooks } from './src/library.ts';
import { lightReader } from './src/light-file.ts';
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
const lightFile = (file: string) => path.resolve(path.dirname(at('./main.ts')), file);

const cfg = readConfig(process.argv.slice(2), at('./config.json'));
if (cfg) await main(cfg);

async function main(c: NonNullable<typeof cfg>) {
  let output: ReturnType<typeof createOutput> | null = null;
  let engine: ReturnType<typeof createEngine>;
  let lib: ReturnType<typeof readLibrary>;
  let page: Awaited<ReturnType<typeof controlServer>> | null = null;
  let loop: ReturnType<typeof runLoop> | undefined;
  let every: ReturnType<typeof setInterval> | undefined, lightEvery: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let started = false, stopping = false, failed = false;
  const stop = async (why: string, failure = false) => {
    failed ||= failure;
    if (stopping) return;
    stopping = true;
    log(`${why}: ${failure ? 'sending black' : 'fading to black'}`);
    if (!failure && started) {
      engine.fadeOut();
      await new Promise((r) => setTimeout(r, 1100));
    }
    loop?.stop();
    clearInterval(every);
    clearTimeout(deadline);
    clearInterval(lightEvery);
    const results = await Promise.allSettled([output?.close(), page?.close()]);
    for (const r of results) if (r.status === 'rejected') log(`cleanup: ${String(r.reason)}`);
    process.exit(failed || results.some((r) => r.status === 'rejected') ? 1 : 0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('uncaughtException', (e) => void stop(e.stack ?? e.message, true));
  process.on('unhandledRejection', (e) => void stop(String(e), true));
  try { await start(); } catch (e) { await stop((e as Error).stack ?? String(e), true); }

  async function start() {
    const rig = json('../public/data/rig.json'), table: PowerTable = json('./data/power.json');
    const relay = createRelay({ count: rig.count, fps: rig.output?.fps || 40 });
    // Reserve the control port before reading looks or opening output. Until startup completes sockets get 503.
    page = c.http ? await controlServer({ get engine() { return engine; }, get lib() { return lib; },
      state: () => state(), ready: () => started && !stopping, pin: c.pin, mode: c.mode, port: c.http,
      host: c.bind, base: c.base, log, relay }) : null;
    if (stopping) return;
    checkPixels(rig, table);
    lib = readLibrary(at('../public/patterns'));
    const looks = readLooks([at('./looks'), at('./local/looks'), ...(c.looks ? [path.resolve(c.looks)] : [])], lib);
    for (const [id, l] of looks) if (l.error) log(`look ${id} cannot play: ${l.error}`);
    // The light settings (SPEC "Light and output"): Studio's Light page downloads them as pi/light.json; missing,
    // the defaults. On the way out only: the engine's frames (and the Live tab's) stay the look's own.
    const readLight = lightReader(lightFile(c.light)), light = readLight()!;
    // Looks' bakes from Studio's frames folder, when it says where (SPEC-offline "Playing on the lights").
    const frames = c.frames && path.resolve(path.dirname(at('./main.ts')), c.frames);
    engine = createEngine({ rig, lib, looks: () => looks, safe: c.safe, mode: c.mode, log, light, relay,
      output: (cells) => output!.send(cells), bake: (id, sha256) => loadBaked(frames, id, sha256, engine.scene) });
    // Saved again (Studio's Light page renames a new file in), the settings apply live; a broken one keeps the last.
    lightEvery = setInterval(() => {
      try {
        const next = readLight();
        if (!next) return;
        engine.setLight(next);
        log(`light settings changed: gamma ${next.gamma}`);
      } catch (e) { log(`light settings kept: ${(e as Error).message}`); }
    }, 2000);
    // The rig's pixels must sit within the cells the expansion reads (its declared universes run past them, unused).
    const cellsEnd = Math.min(...table.petals.map((p) => p.exp));
    if (Math.max(...engine.scene.addr) + table.cellChannels > cellsEnd) throw new Error('the rig overlaps the rose');
    output = createOutput({ table, power: c, dryRun: c.dryRun, host: c.host, port: c.port });
    await output.ready;
    if (stopping) return;
    const to = c.dryRun ? 'DRY RUN, nothing sent' : `DDP ${c.host}:${c.port}`;
    log(`${to}, channels 1-${table.channels} (rose expanded), `
      + `rig ${rig.name} ${rig.count} px at ${engine.fps} fps, power cap ${c.cap} gen ${c.gen} W, library ${lib.hash}, `
      + `${[...looks.values()].filter((l) => l.look).length} looks, gamma ${light.gamma}`);
    engine.play(looks.get(c.look)?.look ? c.look : c.safe);

    // A dry run renders only while someone has its page open (Studio's feed is no one); the Pi always plays.
    loop = runLoop(engine, engine.fps, undefined, () => c.dryRun && page?.watching() === 0);
    let cutBefore = 0;
    every = setInterval(() => {
      const o = output!.status();
      log(statsLine(engine, o, loop!.fps(), o.cut - cutBefore, relay.state()));
      cutBefore = o.cut;
    }, c.stats * 1000);

    const list = [...looks].map(([id, l]) => ({ id, title: l.look?.title ?? id, playable: !!l.look,
      duration: l.look?.duration || 30,
      ...(l.error ? { error: l.error } : {}) })).sort((a, b) => a.title.localeCompare(b.title));
    const state = (): EngineState => {
      const o = output!.status(), s = engine.stats;
      return { ...engine.state(), looks: list, out: { dryRun: c.dryRun, fps: loop!.fps(), renderMs: s.renderMs,
        genW: o.genW, genPeakW: o.genPeakW, gen: c.gen, cut: o.cut, ddpErrors: o.errors, lastError: o.lastError },
        relay: relay.state() };
    };
    started = true;
    if (page) log(`control page on http://${c.bind}:${page.port}${c.base}/${c.pin ? ' (PIN set)' : ''}`);

    if (c.seconds) deadline = setTimeout(() => void stop(`${c.seconds} s up`), c.seconds * 1000);
  }
}
