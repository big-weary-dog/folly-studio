#!/usr/bin/env node
// The output guard: every look of tools/bench-looks.ts played as the Pi's engine plays it (live controls, renderFrame,
// ledChannels at a master that moves), each look's LED bytes over a few frames hashed, on both rigs. A speed-up must
// leave every hash as it is (test/output-bytes.test.ts); a change to a pattern or a rig on purpose re-records them:
//   node tools/output-bytes.ts        → test/fixtures/output-bytes.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compileLayer, ledChannels, prepareLayer, prepareLight, prepareScene, renderFrame, setLibrary }
  from '../public/js/pattern-core.ts';
import { liveLook } from '../pi/src/controls.ts';
import { resolveLook } from '../pi/src/library.ts';
import { chainLooks, lib, libraryLooks } from './bench-looks.ts';

export const RIGS = ['rig.json', 'rig-folly.json'];
export const BYTES = fileURLToPath(new URL('../test/fixtures/output-bytes.json', import.meta.url));
// Frames played: the first few in a row (stateful modules), then a jump; the master each is sent at.
const FRAMES = [0, 1, 2, 3, 4, 5, 292, 293], CAPS = [1, 1, 0.62, 1, 0.3, 1, 0.85, 1];

/** Each look's id → a hash of its LED bytes over FRAMES (or why it cannot play), on the rig in public/data/. */
export function outputBytes(rigFile: string) {
  setLibrary([...lib.entries.values()]);
  const rig = JSON.parse(readFileSync(new URL(`../public/data/${rigFile}`, import.meta.url), 'utf8'));
  const scene = prepareScene(rig), dt = 1 / scene.fps, light = prepareLight(scene);
  const rgb = new Float32Array(scene.count * 3), cells = new Uint8Array(scene.frameChannels);
  const out: Record<string, string> = {};
  for (const look of [...libraryLooks(), ...chainLooks()]) {
    try {
      const r = resolveLook(look, lib), live = liveLook(r), sum = createHash('sha256');
      const layers = r.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
      FRAMES.forEach((f, i) => {
        const t = (f * dt) % (r.duration || 30);
        live.step(t, dt);
        const { errors } = renderFrame(scene, layers, t, rgb, live.look);
        if (errors.length) sum.update(`error ${errors[0]!.error}`);
        sum.update(ledChannels(scene, rgb, light, cells, CAPS[i]));
      });
      out[look.id] = sum.digest('hex').slice(0, 16);
    } catch (e) {
      out[look.id] = `cannot play: ${(e as Error).message}`;
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rigs = Object.fromEntries(RIGS.map((r) => [r, outputBytes(r)]));
  writeFileSync(BYTES, `${JSON.stringify({ about: 'tools/output-bytes.ts: each look\'s LED bytes, hashed', rigs },
    null, 1)}\n`);
  console.log(`${BYTES}: ${RIGS.map((r) => `${r} ${Object.keys(rigs[r]!).length} looks`).join(', ')}`);
}
