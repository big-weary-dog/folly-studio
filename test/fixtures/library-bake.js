// A worker for test/library-flash.test.js: bakes library sources on their defaults over the whole Folly as
// the render box does (render-box/renderer.ts: 40 fps, the look's default globals, sparse LED channels), then
// runs src/frames.ts's flash check on each. workerData: { names, seconds } → [{ name, ok, maxHz, small, errors }]; a
// name may be { name, params } to bake it on those.
import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

import * as core from '../../public/js/pattern-core.ts';
import { ledRanges, writeFseq } from '../../public/js/fseq.ts';
import { renderer } from '../../render-box/renderer.ts';
import { analyzeFrames, parseFseq } from '../../src/frames.ts';

const here = (p) => new URL(p, import.meta.url);
const rig = JSON.parse(readFileSync(here('../../public/data/rig.json'), 'utf8'));
const ranges = ledRanges(rig), scene = core.prepareScene(rig);
const watch = new core.FlashWatch(scene, null, { record: true });

const results = workerData.names.map((n) => {
  const { name, params } = typeof n === 'string' ? { name: n } : n;
  const code = readFileSync(here(`../../public/patterns/${name}.js`), 'utf8');
  const { packed, next } = renderer(core, rig, [{ id: name, code, params }], ranges, {});
  const frames = workerData.seconds * 40, data = new Uint8Array(frames * packed.length);
  let errors = 0;
  for (let f = 0; f < frames; f++) {
    errors += next().length;
    data.set(packed, f * packed.length);
  }
  const { flicker } = analyzeFrames(parseFseq(writeFseq({ frames, data, ranges })), scene, watch);
  return { name, ok: flicker.ok, maxHz: flicker.maxHz, small: flicker.small.regions, errors };
});
parentPort.postMessage(results);
