// The output guard (tools/output-bytes.ts): every library look, and every module in a chain a moving warp bends,
// sends the LED bytes recorded in test/fixtures/output-bytes.json, on both rigs. The engine's speed-ups keep every
// byte; a pattern or a rig changed on purpose re-records them.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { BYTES, outputBytes, RIGS } from '../tools/output-bytes.ts';

const HOW = 'LED bytes moved. A pattern or the rig changed on purpose: node tools/output-bytes.ts re-records them;'
  + ' otherwise the engine changed what the LEDs get';
const recorded = JSON.parse(readFileSync(BYTES, 'utf8')).rigs;

for (const rig of RIGS) {
  test(`warming then seeking to zero preserves every look's LED bytes on ${rig}`, () => {
    expect(outputBytes(rig, true)).toEqual(recorded[rig]);
  });
  test(`every look sends the LED bytes recorded on ${rig}`, () => {
    const now = outputBytes(rig), was = recorded[rig];
    const moved = Object.keys({ ...was, ...now }).filter((id) => now[id] !== was[id])
      .map((id) => `${id}: ${was[id] ?? 'new'} → ${now[id] ?? 'gone'}`);
    expect(moved.length ? `${HOW}\n${moved.join('\n')}` : '').toBe('');
  });
}
