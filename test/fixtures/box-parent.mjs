// A real library-only bake whose host the parent-death regression kills without running any cleanup.
import { readFileSync } from 'node:fs';
import { createRenderBox } from '../../src/render-box.ts';

const box = createRenderBox({ bwrap: 'no-such-bwrap', systemdRun: '', nice: 0, seconds: 600,
  tmpRoot: process.argv[2],
  log: { info() {}, warn() {}, error() {}, debug() {} } });
await box.render({ layers: [{ id: 'wash', groups: [],
  code: readFileSync(new URL('../../public/patterns/colour-wash.js', import.meta.url), 'utf8') }] });
