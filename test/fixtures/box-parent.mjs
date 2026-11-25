// A real library-only bake whose host the parent-death regression kills without running any cleanup.
import { createRenderBox } from '../../src/render-box.ts';
import { libraryCode } from './patterns.js';
import { quiet } from './quiet.js';

const box = createRenderBox({ systemdRun: '', nice: 0, seconds: 600,
  tmpRoot: process.argv[2],
  log: quiet });
await box.render({ layers: [{ id: 'wash', groups: [],
  code: libraryCode('colour-wash') }] });
