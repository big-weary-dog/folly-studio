// The render check (SPEC-generators "The render check"): a generated look rendered for a few seconds in the render box
// before it is saved, so a look that cannot load, a layer that throws or gives NaN, or a slow one goes back to the
// model with the box's words. What the box says is untrusted: bounded and read as data. No box: no check (null).

import type { Light } from '../../public/js/pattern-core.ts';
import type { Bake } from '../../shared/schemas/api.ts';
import type { Rig } from '../../shared/schemas/rig.ts';
import { BakeError, checkFrames } from '../box-output.ts';
import type { RenderBox } from '../render-box.ts';
import type { ExpandError } from './expand.ts';

export type Box = Pick<RenderBox, 'probe' | 'render'>;
type Lane = { run<T>(fn: () => T | Promise<T>): Promise<T> };
type Look = { layers: { id?: string, title?: string }[], globals?: unknown, automation?: unknown, bpm?: unknown };
export type Seen = { errors: ExpandError[], ms: number, seconds: number, bytes?: Uint8Array,
  analysis?: NonNullable<Bake['analysis']> };

const SLOW_MS = 20; // the average frame, of the 25 a frame 40 fps leaves
const said = (v: unknown, n = 200) => String(v ?? '').replace(/[^\P{C}\n]/gu, ' ').slice(0, n);

/** The box's per-layer reports → errors, by the look's layer titles (the model knows its layers by title). */
function layerErrors(look: Look, reported: unknown): ExpandError[] {
  const r = reported && typeof reported === 'object' ? reported as Record<string, unknown> : {};
  const name = (id: unknown) => {
    const i = look.layers.findIndex((l) => l.id === id);
    return i < 0 ? 'a layer' : `layer ${i + 1} "${said(look.layers[i]!.title, 60)}"`;
  };
  const out = (Array.isArray(r.layers) ? r.layers : []).slice(0, 8).flatMap((l) => {
    const e = l && typeof l === 'object' ? l as Record<string, unknown> : {};
    return Number(e.errorFrames) > 0 ? [{ path: name(e.id), code: 'runtime', message: `throws or gives NaN in ${
      Math.round(Number(e.errorFrames))} frames: ${said(e.firstError)}` }] : [];
  });
  const avg = Number((r.msPerFrame as Record<string, unknown> | undefined)?.average);
  if (avg > SLOW_MS) {
    out.push({ path: 'look', code: 'slow', message: `a frame takes ${avg.toFixed(1)} ms on average (at most ${
      SLOW_MS}): use fewer or cheaper modules` });
  }
  return out;
}

/** Render `look` for `seconds` in the box (in `lane`, the bakes' turn) → what it showed; null when there is no box. */
export async function renderCheck(box: Box | undefined, look: Look, { seconds, rig, lane, light }: { seconds: number,
  rig: Rig | null, lane?: Lane, light?: Light }): Promise<Seen | null> {
  if (!box || !(await box.probe().catch(() => ({ ok: false }))).ok) return null;
  const t0 = Date.now(), job = { layers: look.layers as never, seconds, globals: look.globals,
    automation: look.automation, bpm: look.bpm };
  try {
    const r = await (lane ? lane.run(() => box.render(job)) : box.render(job));
    const errors = layerErrors(look, r.boxStats?.reported);
    let analysis;
    if (rig) analysis = checkFrames(r.bytes, { source: 'render-box', rig, light }).bake.analysis;
    return { errors, ms: Date.now() - t0, seconds: r.seconds, bytes: r.bytes, ...(analysis ? { analysis } : {}) };
  } catch (err) {
    if (!(err instanceof BakeError)) throw err;
    const errors = [...layerErrors(look, err.boxStats?.reported),
      { path: 'look', code: 'runtime', message: said(err.reason, 300) }];
    return { errors, ms: Date.now() - t0, seconds: 0 };
  }
}
