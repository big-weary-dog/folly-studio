#!/usr/bin/env node
// Composites against the flat chains they stand for (SPEC-library "Composites"), and modules attached to one source
// ("Attached modules"), blur and trails too: ms a frame (mean, p95), on both rigs. Our own library code only. For
// allocation, count scavenges under node --trace-gc: a heap delta is noise.
//
//   node tools/composite-bench.ts [--frames 400]
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../public/js/pattern-core.ts';

const argv = process.argv, at = argv.indexOf('--frames'), FRAMES = at > 0 ? Number(argv[at + 1]) : 400;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const mod = (id: string, kind: string, ref: string, params = {}) => ({ id, kind, ref, title: ref,
  code: read(`../public/patterns/${ref}.js`), params });
const sub = (id: string, modules: object[], more = {}) => ({ id, title: id, modules, ...more });
const comp = (id: string, layers: object[], more = {}) => ({ id, kind: 'composite', title: 'Composite', code: '',
  params: {}, layers, ...more });

const clouds = () => mod('a', 'source', 'clouds'), bars = () => mod('b', 'source', 'bars');
const twist = () => mod('w', 'warp', 'twist'), hue = () => mod('h', 'filter', 'hue-shift');
const sparkle = () => mod('t', 'source', 'sparkle');
const blur = () => mod('x', 'filter', 'blur', { radius: 0.3 }), trails = () => mod('z', 'filter', 'trails');
const CASES: [string, object[]][] = [
  ['flat: clouds, bars, twist', [clouds(), bars(), twist()]],
  ['composite{clouds | bars}, twist', [comp('c', [sub('s1', [clouds()]), sub('s2', [bars()])]), twist()]],
  ['flat: clouds, hue, bars, twist, sparkle', [clouds(), hue(), bars(), twist(), sparkle()]],
  ['composite{clouds, hue | bars}, twist, sparkle',
    [comp('c', [sub('s1', [clouds(), hue()]), sub('s2', [bars()])]), twist(), sparkle()]],
  ['composite{clouds, rotate | bars, twist}, scroll', [comp('c', [sub('s1', [clouds(), mod('r', 'warp', 'rotate')]),
    sub('s2', [bars(), twist()])]), mod('x', 'warp', 'scroll')]],
  ['composite{clouds | composite{bars | sparkle}}, twist', [comp('c', [sub('s1', [clouds()]),
    sub('s2', [comp('d', [sub('s3', [bars()]), sub('s4', [sparkle()])])])]), twist()]],
  ['flat: clouds, bars, sparkle, fire, twist', [clouds(), bars(), sparkle(), mod('f', 'source', 'fire'), twist()]],
  ['composite{clouds | bars | sparkle | fire}, twist', [comp('c', [sub('s1', [clouds()]), sub('s2', [bars()]),
    sub('s3', [sparkle()]), sub('s4', [mod('f', 'source', 'fire')])]), twist()]],
  ['the same, bars and sparkle on parts', [comp('c', [sub('s1', [clouds()]), sub('s2', [bars()], { tags: ['__part'] }),
    sub('s3', [sparkle()], { tags: ['__part'] }), sub('s4', [mod('f', 'source', 'fire')])]), twist()]],
  ['flat: clouds, bars', [clouds(), bars()]],
  ['clouds, twist on clouds, bars', [clouds(), { ...twist(), on: 'a' }, bars()]],
  ['clouds, hue on clouds, bars', [clouds(), { ...hue(), on: 'a' }, bars()]],
  ['flat: clouds, bars, blur', [clouds(), bars(), blur()]],
  ['clouds, blur on clouds, bars', [clouds(), { ...blur(), on: 'a' }, bars()]],
  ['clouds, blur on clouds, bars, blur', [clouds(), { ...blur(), on: 'a' }, bars(), { ...blur(), id: 'y' }]],
  ['flat: clouds, bars, trails', [clouds(), bars(), trails()]],
  ['clouds, trails on clouds, bars', [clouds(), { ...trails(), on: 'a' }, bars()]],
];

for (const name of ['rig.json', 'rig-folly.json']) {
  const rig = JSON.parse(read(`../public/data/${name}`)), scene = prepareScene(rig);
  const tag = rig.groups.filter((g: { tags?: string[] }) => g.tags?.length)[1]?.tags[0] ?? '';
  const rgb = new Float32Array(scene.count * 3);
  console.log(`\n${name}: ${scene.count} LEDs, ${FRAMES} frames`);
  for (const [label, modules] of CASES) {
    const json = JSON.stringify(modules).replaceAll('__part', tag);
    const layer = { id: 'l', modules: JSON.parse(json) };
    const L = prepareLayer(scene, layer, compileLayer(layer));
    for (let f = 0; f < 60; f++) renderFrame(scene, [L], f / 40, rgb);
    const ms = new Float64Array(FRAMES);
    for (let f = 0; f < FRAMES; f++) {
      const a = performance.now();
      const { errors } = renderFrame(scene, [L], f / 40, rgb);
      ms[f] = performance.now() - a;
      if (errors.length) throw new Error(`${label}: ${errors[0].error}`);
    }
    const s = [...ms].sort((x, y) => x - y), mean = s.reduce((x, y) => x + y, 0) / s.length;
    console.log(`${label.padEnd(56)} ${mean.toFixed(2)} ms  p95 ${s[Math.floor(s.length * 0.95)].toFixed(2)} ms`);
  }
}
