// Inside the box, fseq.js is bound next to this file.
import vm from 'node:vm';
import { writeFseq } from './fseq.js';
import { nope } from './nope.js';
export const run = () => [vm, writeFseq, nope, Math.random()];
