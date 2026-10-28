import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';

import { test } from 'vitest';

import { frameOffsets } from '../src/frames.ts';
import { encodePng } from '../src/png.ts';
import { socketOrigin } from '../src/socket-origin.ts';

test('sparse frame offsets preserve wire colour order and leave missing LEDs dark', () => {
  const offsets = frameOffsets({ ranges: [[6, 3], [12, 2]] },
    { addr: new Int32Array([-1, 0, 6, 9, 12, 18]), order: [1, 0, 2] });
  assert.deepEqual(offsets.map((a) => [...a]), [
    [-1, -1, 1, -1, 4, -1], [-1, -1, 0, -1, 3, -1], [-1, -1, 2, -1, -1, -1],
  ]);
});

test('socket origins refuse absent, opaque and foreign origins and preserve listener port rules', () => {
  for (const origin of [undefined, 'null', 'garbage', 'https://other.example', 'http://studio.example:4043']) {
    assert.equal(socketOrigin(origin, 'studio.example'), false);
  }
  assert.equal(socketOrigin('https://STUDIO.example', 'studio.example:443'), true);
  assert.equal(socketOrigin('http://studio.example', 'STUDIO.example:80', false), true);
  assert.equal(socketOrigin('https://studio.example', 'studio.example:443', false), false);
  assert.equal(socketOrigin('http://studio.example:4043', 'studio.example:4043', false), true);
});

test('PNG encoder writes RGB scanlines with valid chunk lengths and checksums', () => {
  const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 12, 34, 56]);
  const png = encodePng(2, 2, rgb), chunks = new Map<string, Buffer>();
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  for (let at = 8; at < png.length;) {
    const size = png.readUInt32BE(at), end = at + 8 + size;
    assert.equal(png.readUInt32BE(end), crc32(png.subarray(at + 4, end)));
    chunks.set(png.toString('latin1', at + 4, at + 8), png.subarray(at + 8, end));
    at = end + 4;
  }
  assert.deepEqual([...chunks.keys()], ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual([...chunks.get('IHDR')!], [0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  assert.deepEqual([...inflateSync(chunks.get('IDAT')!)], [0, ...rgb.subarray(0, 6), 0, ...rgb.subarray(6)]);
});
