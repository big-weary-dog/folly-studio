// The one rule (SPEC "Modules"): every module of a chain works on what is above it, so a warp bends the modules above
// it, up to the nearest stage end: a module that holds real LED colours (a blur, trails), which nothing below it
// reaches past. Per pixel, each module reads one of a few copies of the pixel (slots), bent bottom-up.
import type { Module } from '../../../shared/schemas/look.ts';

/** What a filter's `stage` may declare: it reads its neighbours (with a spatial op), or keeps colours across frames. */
export const STAGES = Object.freeze(['spatial', 'history'] as const);
// The declaration, a literal at the top level: `const stage = 'spatial' | 'history'`, or a spatial op (one anyway).
const DECLARES = new RegExp(String.raw`^[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+`
  + String.raw`(?:stage[ \t]*=[ \t]*(['"])(spatial|history)\1|spatial[ \t]*=)`, 'm');
type Declares = Partial<Pick<Module, 'kind' | 'code'>>;
/** The stage a filter's code declares ('spatial' for a spatial op), or null. */
export function stageOf(m: Declares): (typeof STAGES)[number] | null {
  const d = m.kind === 'filter' ? DECLARES.exec(m.code ?? '') : null;
  return d ? (d[2] as (typeof STAGES)[number] | undefined) ?? 'spatial' : null;
}
/** Does m hold real LED colours, so that no warp below it reaches above it? A filter whose code declares a stage. */
export const isStageEnd = (m: Declares) => stageOf(m) !== null;

/** What placeWarps reads (kind, end) and sets: the slot a link reads (at); a bending warp's from and to slots. */
type Placed = { kind: number, end: boolean, ix: number, at: number, from: number, to: number };

/**
 * Each link's slot. A warp with anything above it in its stage bends a copy of the slot below it (`from`) into its
 * own (`to`), in place when nothing below still reads `from`: slot 0, the pixel itself, is bent in place only in an
 * execution stage without trails (which read it). → the bending warps bottom-up (the order they run), the slots.
 */
export function placeWarps<T extends Placed>(chain: T[], WARP_KIND: number, SPATIAL_KIND: number) {
  const n = chain.length, bends: boolean[] = [], stage: number[] = [], shared: boolean[] = [];
  let above = false, s = 0;
  for (let i = 0; i < n; i++) {
    const M = chain[i];
    M.ix = i; M.at = 0; M.from = M.to = -1;
    stage[i] = s;
    if (M.kind === WARP_KIND) bends[i] = above;
    else above = !M.end;
    if (M.end && M.kind !== SPATIAL_KIND) shared[s] = true;
    if (M.kind === SPATIAL_KIND) s++;
  }
  const order: T[] = [];
  let cur = 0, read = false, slots = 1;
  for (let i = n - 1; i >= 0; i--) {
    const M = chain[i];
    if (M.end) { cur = 0; read = false; continue; }
    M.at = cur;
    if (M.kind !== WARP_KIND) { read = true; continue; }
    if (!bends[i]) continue;
    M.from = cur;
    M.to = read || (cur === 0 && shared[stage[i]]) ? slots++ : cur;
    cur = M.to; read = false;
    order.push(M);
  }
  return { order, slots };
}
