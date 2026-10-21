// Structural and timing evidence for the report; no production contract changes.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { compileLayer, prepareLayer, prepareScene, renderFrame, tagMask } from '../../public/js/pattern-core.ts';
import { candidates, code, look, reportDir } from './rose-warps-cases.js';

const results = [];
for (const filename of ['rig.json', 'rig-folly.json']) {
  const scene = prepareScene(JSON.parse(readFileSync(`public/data/${filename}`, 'utf8')));
  const mask = tagMask(scene, 'rose'), rose = Array.from(mask.keys()).filter((k) => mask[k]);
  const out = new Float32Array(scene.count * 3);
  const prepare = (body) => prepareLayer(scene, body, compileLayer(body));
  const baselineSource = renderFrame(scene, [prepare(look('bars').layers[0])], 2, out).rgb.slice();
  const probe = `function pixel(p) { return [(p.sector + 1) / 17, p.ring / 8, (p.k + 1) / 10000]; }`;
  for (const c of candidates) {
    for (const setting of c.settings) {
    const modules = [
      { id: 'probe', kind: 'source', code: probe },
      { id: 'warp', kind: 'warp', code: code(c.name), params: setting },
    ];
    const layer = prepare({ id: 'probe', tags: ['all'], modules });
    let r = renderFrame(scene, [layer], 2, out);
    assert.deepEqual(r.errors, [], `${filename}: ${c.name}`);
    let outsideChanged = 0, sectorErrors = 0, ringErrors = 0;
    const samples = new Set(), mapping = new Int32Array(scene.count);
    for (let k = 0; k < scene.count; k++) {
      const sector = Math.round(out[k * 3] * 17) - 1, ring = Math.round(out[k * 3 + 1] * 8);
      const i = Math.round(out[k * 3 + 2] * 10000) - 1;
      mapping[k] = i;
      if (!mask[k]) {
        if (sector !== scene.sector[k] || ring !== scene.ring[k] || i !== k) outsideChanged++;
        continue;
      }
      samples.add(`${sector}/${i}`);
      if (['rose-ring-turn', 'rose-stride', 'rose-shift', 'rose-fold', 'rose-kaleido'].includes(c.name)) {
        if (ring !== scene.ring[k]) ringErrors++;
      }
      const sr = scene.ring[k], sp = scene.sector[k];
      if (c.name === 'rose-ring-reverse') {
        const expectedRing = sr >= setting.inner && sr <= setting.outer ? setting.inner + setting.outer - sr : sr;
        if (ring !== expectedRing) ringErrors++;
      }
      let expected;
      if (c.name === 'rose-ring-turn') {
        const sign = setting.alternate && (sr - 1) % 2 ? -1 : 1;
        expected = ((sp - sign * (sr - 1) * setting.step) % 16 + 16) % 16;
      }
      if (c.name === 'rose-stride') expected = (sp * Number(setting.stride.slice(1)) + (setting.offset || 0)) % 16;
      if (c.name === 'rose-shift') expected = setting.swap
        ? (sp + (Math.floor(sp / setting.offset) % 2 ? -setting.offset : setting.offset) + 16) % 16
        : (sp - setting.offset + 16) % 16;
      if (c.name === 'rose-fold') {
        const size = 16 / ({ two: 2, four: 4, eight: 8, sixteen: 16 }[setting.repeats]);
        const reflect = Math.floor(sp / size) % 2;
        expected = ((setting.offset || 0) + (reflect ? size - 1 - sp % size : sp % size)) % 16;
      }
      if (c.name === 'rose-kaleido') expected = setting.petal;
      if (c.name === 'rose-spiral') {
        const addr = (((sr - 1) * 16 + sp) * Number(setting.stride.slice(1)) + setting.offset) % 112;
        expected = addr % 16;
        if (ring !== Math.floor(addr / 16) + 1) ringErrors++;
      }
      if (expected !== undefined && sector !== expected) sectorErrors++;
    }
    assert.equal(outsideChanged, 0, `${filename}: ${c.name} must leave non-rose pixels alone`);
    assert.equal(sectorErrors, 0, `${filename}: ${c.name} sector mapping`);
    assert.equal(ringErrors, 0, `${filename}: ${c.name} ring mapping`);
    const visual = prepare(look('bars', c.name, setting).layers[0]);
    renderFrame(scene, [visual], 2, out);
    for (const k of rose) for (let a = 0; a < 3; a++) {
      assert.equal(out[k * 3 + a], baselineSource[mapping[k] * 3 + a], `${c.name} exact LED sample`);
    }
    for (let k = 0; k < 20; k++) renderFrame(scene, [visual], k / 40, out);
    const costs = [];
    for (let k = 0; k < 80; k++) {
      const start = performance.now();
      r = renderFrame(scene, [visual], 2 + k / 40, out);
      costs.push(performance.now() - start);
      assert.deepEqual(r.errors, []);
    }
    const first = renderFrame(scene, [visual], 2, out).rgb.slice();
    renderFrame(scene, [visual], 5, out);
    assert.deepEqual(renderFrame(scene, [visual], 2, out).rgb, first, `${c.name} seek deterministic`);
    costs.sort((a, b) => a - b);
    results.push({ rig: filename, warp: c.name, setting, rosePixels: rose.length, uniqueSamples: samples.size,
      outsideChanged, sectorErrors, ringErrors, medianMs: costs[40], p95Ms: costs[76] });
    }
    for (const source of ['clouds', 'single-strand', 'sparkle', 'plasma']) {
      const modules = source === 'plasma'
        ? [{ id: 'source', kind: 'source', code: code('bars'), params: { profile: 'smooth', bars: 12 } },
          { id: 'flow', kind: 'warp', code: code('turbulence'), params: { amount: 0.5, size: 0.3 } }]
        : [{ id: 'source', kind: 'source', code: code(source) }];
      modules.push({ id: 'warp', kind: 'warp', code: code(c.name), params: c.motion });
      const extra = prepare({ id: 'other-source', tags: ['rose'], modules });
      for (const t of [0, 0.5, 2]) assert.deepEqual(renderFrame(scene, [extra], t, out).errors, []);
      const sought = renderFrame(scene, [extra], 0.5, out).rgb.slice();
      renderFrame(scene, [extra], 3, out);
      assert.deepEqual(renderFrame(scene, [extra], 0.5, out).rgb, sought, `${c.name}/${source} motion seek`);
    }
  }
  const baseline = prepare(look('bars').layers[0]), costs = [];
  for (let k = 0; k < 100; k++) {
    const start = performance.now(); renderFrame(scene, [baseline], 2 + k / 40, out);
    if (k >= 20) costs.push(performance.now() - start);
  }
  costs.sort((a, b) => a - b);
  results.push({ rig: filename, warp: 'baseline', medianMs: costs[40], p95Ms: costs[76] });
}
mkdirSync(reportDir, { recursive: true });
writeFileSync(`${reportDir}/validation.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
