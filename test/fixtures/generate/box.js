// A stand-in render box over the real library, for the rounds' tests (generate-refine, generate-explore).
import fs from 'node:fs';
import path from 'node:path';

import { prepareScene } from '../../../public/js/pattern-core.ts';
import { writeFseq } from '../../../public/js/fseq.ts';
import { buildCatalog } from '../../../src/generate/catalog.ts';
import { RIG, STUDIO } from './shared.js';

const DIR = path.join(STUDIO, 'public/patterns');
export const REAL = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).map((p) => ({ ...p,
  code: p.kind === 'preset' ? '' : fs.readFileSync(path.join(DIR, `${p.name}.js`), 'utf8') }));
export const CATALOG = buildCatalog(REAL);
const SCENE = prepareScene(RIG);

/** `seconds` of frames on the rig, every LED `rgb` (NaN-free; the stand-in box's). */
export function frames(seconds, rgb = [200, 0, 0]) {
  const cc = SCENE.frameChannels, n = Math.round(seconds * 40), data = new Uint8Array(cc * n);
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < SCENE.count; k++) {
      for (let c = 0; c < 3; c++) if (SCENE.addr[k] >= 0) data[f * cc + SCENE.addr[k] + SCENE.order[c]] = rgb[c];
    }
  }
  return Buffer.from(writeFseq({ channelCount: cc, frames: n, data }));
}
/** A stand-in render box: each render's job kept; `reports(job, n)` → what the box says of the nth. */
export function stubBox(reports = () => ({ ok: true })) {
  const jobs = [];
  return { jobs, probe: async () => ({ ok: true }), async render(job) {
    jobs.push(job);
    return { bytes: frames(job.seconds), boxStats: { untrusted: true, reported: reports(job, jobs.length) },
      ms: 1, seconds: job.seconds };
  } };
}
