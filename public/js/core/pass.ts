// One pixel through a run of a chain's links (SPEC "Modules"): sources draw and combine into c, filters rework it,
// and a composite runs each of its sub-layers at its own pixel into the sub-layer's colour, blends them, and joins c
// as a source would (SPEC-library "Composites"). Nothing here allocates: colours and pixels are the links' own.
import type { G } from './globals.ts';
import { addLight } from './light.ts';
import { copyPixel, type Pixel } from './pixel.ts';
import { settle } from './place.ts';
import { hex, RUN } from './stdlib.ts';
import { ADD, COMPOSITE, type Link, MULTIPLY, OVER, SOURCE, UNDER, WARP } from './chain.ts';

/** The link that failed or was running when something threw: a sub-layer's own, not its composite. */
export const PASS: { at: Link | null } = { at: null };

/** v (number, '#hex', [r, g, b, a?], nothing) into out as [r, g, b, a], alpha default `da`. False on NaN. */
export function toColour(v: unknown, out: number[], da: number) {
  let r, g, b, al;
  if (v === undefined || v === null) { r = g = b = al = 0; }
  else if (typeof v === 'number') { r = g = b = v; al = da; }
  else {
    const c = (typeof v === 'string' ? hex(v) : v) as ArrayLike<number>;
    r = +c[0]; g = +c[1]; b = +c[2];
    al = c.length > 3 && c[3] !== undefined ? +c[3] : da;
  }
  if (r !== r || g !== g || b !== b || al !== al) return false;
  out[0] = r; out[1] = g; out[2] = b; out[3] = al < 0 ? 0 : al > 1 ? 1 : al;
  return true;
}

/** o into c (straight alpha) by blend, alpha scaling values and add summing their light; onto nothing it is o. */
export function blendInto(c: number[], o: number[], mode: number) {
  const a = o[3], ca = c[3];
  if (mode === MULTIPLY) {
    for (let i = 0; i < 3; i++) c[i] *= 1 - a + o[i] * a;
    return;
  }
  if (!(ca > 0)) { c[0] = o[0]; c[1] = o[1]; c[2] = o[2]; c[3] = a; return; }
  if (mode === OVER) {
    const keep = ca * (1 - a), A = a + keep;
    for (let i = 0; i < 3; i++) c[i] = (o[i] * a + c[i] * keep) / A;
    c[3] = A;
  } else if (mode === UNDER) {
    const keep = a * (1 - ca), A = ca + keep;
    for (let i = 0; i < 3; i++) c[i] = (c[i] * ca + o[i] * keep) / A;
    c[3] = A;
  } else if (mode === ADD) {
    const A = ca + a < 1 ? ca + a : 1;
    for (let i = 0; i < 3; i++) c[i] = addLight(c[i] * ca, o[i] * a) / A;
    c[3] = A;
  } else {
    const A = a > ca ? a : ca;
    for (let i = 0; i < 3; i++) { const x = c[i] * ca, y = o[i] * a; c[i] = (x > y ? x : y) / A; }
    c[3] = A;
  }
}

const said = (v: unknown) => (Array.isArray(v) ? `[${Array.from(v).slice(0, 4).join(', ')}]` : String(v));

/** A bending warp on pixel slots qs: a copy of its `from` slot unless it bends that in place. */
export function bend(qs: Pixel[], W: Link, T: number, G: G) {
  if (W.to !== W.from) copyPixel(qs[W.to], qs[W.from]);
  const q = qs[W.to];
  PASS.at = W;
  if (W.led && q.due) settle(q);
  RUN.dt = q.dt;
  W.fn(q, T + q.dt, W.P, G);
}

/**
 * Links from..to−1 of `chain` for pixel j (rig LED k) into c, the chain's warps already bent into qs → null, or an
 * error (its link in PASS.at). A source (or composite) that a later stage reads keeps its colour at 4j.
 */
export function pass(chain: Link[], from: number, to: number, qs: Pixel[], c: number[], T: number, G: G, j: number,
  k: number): string | null {
  for (let i = from; i < to; i++) {
    const M = chain[i];
    if (M.kind === WARP) continue;
    const q = qs[M.at];
    PASS.at = M;
    if (q.due && M.led) settle(q);
    RUN.dt = q.dt;
    if (M.kind === SOURCE || M.kind === COMPOSITE) {
      const o = M.out;
      if (M.kind === COMPOSITE) {
        const e = runComposite(M, q, T, G, j, k);
        if (e) return e;
      } else {
        const v = M.fn(q, T + q.dt, M.P, G);
        if (!toColour(v, o, 1)) return `pixel() returned ${said(v)} (NaN) at LED ${k}`;
        o[3] *= q.gate;      // a composite's sub-layers carry it from their copies of q
        if (M.bright) { const b = M.P.brightness as number; o[0] *= b; o[1] *= b; o[2] *= b; }
      }
      if (M.keep) { const x = 4 * j, K = M.keep; K[x] = o[0]; K[x + 1] = o[1]; K[x + 2] = o[2]; K[x + 3] = o[3]; }
      if (!M.hidden) blendInto(c, o, M.blend);
    } else {
      M.ring?.record(j, c);
      const v = M.fn(c, q, T + q.dt, M.P, G, M.input >= 0 ? chain[M.input].out : undefined);
      if (!toColour(v, c, c[3])) return `filter() returned ${said(v)} (NaN) at LED ${k}`;
    }
  }
  return null;
}

/** A composite at pixel q into M.out: each sub-layer from a copy of q, bent by its own warps, run into its colour,
 * scaled by its level and blended in turn; one that plays elsewhere (by rig LED k, as a layer's groups) adds
 * nothing and costs nothing. */
function runComposite(M: Link, q: Pixel, T: number, G: G, j: number, k: number) {
  const out = M.out, subs = M.subs!;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let s = 0; s < subs.length; s++) {
    const S = subs[s], qs = S.qs, c = S.c;
    if (S.mask && S.mask[k] === 0) continue;
    copyPixel(qs[0], q);
    for (let w = 0; w < S.warps.length; w++) bend(qs, S.warps[w], T, G);
    c[0] = c[1] = c[2] = c[3] = 0;
    const e = pass(S.chain, 0, S.chain.length, qs, c, T, G, j, k);
    if (e) return e;
    c[3] *= S.level;
    blendInto(out, c, S.blend);
  }
  RUN.dt = q.dt;
  return null;
}
