// Isolated reader memory measurement: a 600 s bake must not become a 600 s allocation.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prepareScene } from '../../public/js/pattern-core.ts';
import { loadBaked } from '../../pi/src/baked.ts';

const [rigFile, file, sha] = process.argv.slice(2);
const scene = prepareScene(JSON.parse(readFileSync(rigFile, 'utf8')));
global.gc();
const base = process.memoryUsage().arrayBuffers;
let peak = base;
const sample = () => { peak = Math.max(peak, process.memoryUsage().arrayBuffers); };
const timer = setInterval(sample, 1);
const b = await loadBaked(path.dirname(file), path.basename(file, '.fseq'), sha, scene);
sample();
clearInterval(timer);
const rgb = new Float32Array(scene.count * 3);
for (const frame of [0, 240 * scene.fps, 600 * scene.fps - 1, 600 * scene.fps]) b.fill(frame, rgb);
global.gc();
const retained = process.memoryUsage().arrayBuffers - base;
b.close();
console.log(JSON.stringify({ duration: b.duration, peakBufferBytes: peak - base,
  retainedBufferBytes: retained, maxRssKiB: process.resourceUsage().maxRSS }));
