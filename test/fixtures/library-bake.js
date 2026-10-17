// A worker for test/library-flash.test.js: bakes library sources on their defaults over the whole cathedral as
// the render box does (render-box/renderer.mjs: 40 fps, the look's default globals, sparse LED channels), then
// runs src/frames.js's flash check on each. workerData: { names, seconds } → [{ name, ok, maxHz, small, errors }].
import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

import * as core from '../../public/js/pattern-core.js';
import { ledRanges, writeFseq } from '../../public/js/fseq.js';
import { renderer } from '../../render-box/renderer.mjs';
import { analyzeFrames, parseFseq } from '../../src/frames.js';

const here = (p) => new URL(p, import.meta.url);
const cathedral = JSON.parse(readFileSync(here('../../public/data/cathedral.json'), 'utf8'));
const ranges = ledRanges(cathedral);

const results = workerData.names.map((name) => {
  const code = readFileSync(here(`../../public/patterns/${name}.js`), 'utf8');
  const { packed, next } = renderer(core, cathedral, [{ id: name, groups: ['cathedral'], code }], ranges, {});
  const frames = workerData.seconds * 40, data = new Uint8Array(frames * packed.length);
  let errors = 0;
  for (let f = 0; f < frames; f++) {
    errors += next().length;
    data.set(packed, f * packed.length);
  }
  const { flicker } = analyzeFrames(parseFseq(writeFseq({ frames, data, ranges })), cathedral);
  return { name, ok: flicker.ok, maxHz: flicker.maxHz, small: flicker.small.regions, errors };
});
parentPort.postMessage(results);
