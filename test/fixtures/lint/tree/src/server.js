// The server side.
import { execFile } from 'node:child_process';
import vm from 'node:vm';
import fs from 'fs';
import { writeFseq } from '../public/js/fseq.js';
import { compile } from '../public/js/pattern-core.js';
import data from '../public/data/groups.json' with { type: 'json' };
import { view } from '../public/js/ui/view.js';
export const secret = 1;
console.log('started');
const read = fs.readFileSync;
const r = Math.random();
const x = new Function('return 1');
export { execFile, vm, writeFseq, compile, data, view, read, r, x };
