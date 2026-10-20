// Library modules as one layer on City of Gods, rendered in-process: for tests of what an effect draws.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { compileLayer, prepareLayer, prepareScene, renderFrame } from '../../public/js/pattern-core.ts';
import { cog } from './rigs.js';

const here = (p) => new URL(p, import.meta.url);
const lib = (name) => readFileSync(here(`../../public/patterns/${name}.js`), 'utf8');
const KIND = Object.fromEntries(JSON.parse(readFileSync(here('../../public/patterns/index.json'), 'utf8'))
  .map((e) => [e.name, e.kind]));
export const COG = prepareScene(cog);

/** A layer of modules [name, params, code?] on City of Gods' `groups` (with code: a source, or a warp if it is one). */
export function layerOn(groups, ...mods) {
  const kind = (name, code) => (!code ? KIND[name] : /function warp/.test(code) ? 'warp' : 'source');
  const layer = { id: 'l', groups, modules: mods.map(([name, params = {}, code], i) => ({ id: `m${i}`,
    kind: kind(name, code), ...(code ? {} : { ref: name }), code: code ?? lib(name), params })) };
  return prepareLayer(COG, layer, compileLayer(layer));
}
/** A layer of library modules [name, params] on the whole of City of Gods. */
export const layerOf = (...mods) => layerOn(undefined, ...mods);
/** L rendered at t, with no errors. */
export function at(L, t) {
  assert.deepEqual(renderFrame(COG, [L], t).errors, []);
  return L;
}
/** The share of L's LEDs whose alpha is over `over`. */
export const litShare = (L, over = 0) => L.idx.reduce((s, _, j) => s + (L.buf[4 * j + 3] > over ? 1 : 0), 0)
  / L.idx.length;
