#!/usr/bin/env node
// The output guard: every look of tools/bench-looks.ts played through the core (prepareLook, renderFrame, ledChannels
// at a master that moves), each look's LED bytes over a few frames hashed, on both rigs. A speed-up must leave every
// hash as it is (test/output-bytes-*.test.ts); intentional pattern, rig or output-default changes re-record:
//   node tools/output-bytes.ts        → test/fixtures/output-bytes.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  compileLayer, ledChannels, prepareLayer, prepareLight, prepareLook, prepareScene, renderFrame, setLibrary,
} from '../core/pattern-core.ts';
import { chainLooks, lib, libraryLooks, resolveLook } from './bench-looks.ts';

export const RIGS = ['rig.json', 'rig-folly.json'];
export const BYTES = fileURLToPath(new URL('../test/fixtures/output-bytes.json', import.meta.url));
// Frames played: the first few in a row (stateful modules), then a jump; the master each is sent at.
const FRAMES = [0, 1, 2, 3, 4, 5, 292, 293], CAPS = [1, 1, 0.62, 1, 0.3, 1, 0.85, 1];

/** Each look's id → a hash of its LED bytes over FRAMES (or why it cannot play), on the rig in public/data/: `cold`
 * from a fresh start, `warm` played again on the same layers after 8 more frames, so a seek to zero must reset them. */
export function outputBytes(rigFile: string) {
  setLibrary([...lib.entries.values()]);
  const rig = JSON.parse(readFileSync(new URL(`../public/data/${rigFile}`, import.meta.url), 'utf8'));
  const scene = prepareScene(rig), dt = 1 / scene.fps, light = prepareLight(scene);
  const rgb = new Float32Array(scene.count * 3), cells = new Uint8Array(scene.frameChannels);
  const cold: Record<string, string> = {}, warm: Record<string, string> = {};
  for (const look of [...libraryLooks(), ...chainLooks()]) {
    try {
      const r = resolveLook(look), L = prepareLook(r);
      const layers = r.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
      const played = () => {
        const sum = createHash('sha256');
        FRAMES.forEach((f, i) => {
          const { errors } = renderFrame(scene, layers, (f * dt) % (r.duration || 30), rgb, L);
          if (errors.length) sum.update(`error ${errors[0]!.error}`);
          sum.update(ledChannels(scene, rgb, light, cells, CAPS[i]));
        });
        return sum.digest('hex').slice(0, 16);
      };
      cold[look.id] = played();
      for (let f = 8; f > 0; f--) renderFrame(scene, layers, f * dt, rgb, L);
      warm[look.id] = played();
    } catch (e) {
      cold[look.id] = warm[look.id] = `cannot play: ${(e as Error).message}`;
    }
  }
  return { cold, warm };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rigs = Object.fromEntries(RIGS.map((r) => [r, outputBytes(r).cold]));
  writeFileSync(BYTES, `${JSON.stringify({ about: 'tools/output-bytes.ts: each look\'s LED bytes, hashed', rigs },
    null, 1)}\n`);
  console.log(`${BYTES}: ${RIGS.map((r) => `${r} ${Object.keys(rigs[r]!).length} looks`).join(', ')}`);
}
