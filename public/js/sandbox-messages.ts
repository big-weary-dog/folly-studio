// The worker's answers read as data (SPEC "Sandbox protocol"): pattern code shares the worker's thread and can post
// too, so the relay passes on only what these bound. Pure: what the relay knows comes in as arguments.
import type { FrameError, ToSandbox } from './runtime.ts';

export type Layer = Extract<ToSandbox, { type: 'look' }>['layers'][number];
/** Why a layer is held back: it hung (until its code changes), or its top-level code did (`load`). */
export type Paused = { error: string; code?: string; params?: object; load?: true };
/** A layer's pause, or null; null for none paused at all, so a frame skips the look. */
export type PausedOf = ((l: Layer) => Paused | null) | null;
/** What the worker says; every field is checked before it goes on. */
export type FromWorker = { type: 'ready' | 'compiled' | 'frame' | 'rendered' | 'progress' | 'compiling' | 'error';
  id?: unknown; seq?: number; done?: unknown; layers?: unknown; rgb?: unknown; errors?: unknown; ms?: unknown;
  layerMs?: unknown; channels?: unknown; request?: string; error?: unknown };
type Reported = { id?: unknown; ok?: unknown; error?: unknown; params?: unknown; upgraded?: unknown;
  modules?: unknown };

export const TEXT_MAX = 300;     // an error's characters, as the render box's
// oxlint-disable-next-line no-control-regex -- control characters are what it strips from the worker's text
const CONTROL = /[\u0000-\u001f\u007f]/g;
const NONE: readonly FrameError[] = Object.freeze([]);

/** Text pattern code can set, as one printable line of at most TEXT_MAX characters ('error' for no text). */
export const text = (v: unknown) => (typeof v === 'string' && v ? v.replace(CONTROL, ' ').slice(0, TEXT_MAX) : 'error');
const time = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v < Infinity;
const ms = (v: unknown) => (time(v) ? v : 0);
const object = (v: unknown) => (v && typeof v === 'object' ? v : {});
const records = (v: unknown) => (Array.isArray(v) ? v : []).filter((r) => r && typeof r === 'object') as Reported[];
export const enabled = (l: Layer) => l.enabled !== false
  && (typeof l.level === 'number' && Number.isFinite(l.level) ? l.level > 0 : true);

/** A frame's errors: at most one per layer of the look, then one for each paused layer that would be playing. */
export function frameErrors(errors: unknown, look: readonly Layer[], pausedOf: PausedOf): readonly FrameError[] {
  if (!(Array.isArray(errors) && errors.length) && !pausedOf) return NONE;
  const out: FrameError[] = [];
  for (const e of records(errors)) {
    if (!look.some((l) => l.id === e.id) || out.some((o) => o.id === e.id)) continue;
    const m = (e as { module?: unknown }).module;
    out.push(typeof m === 'string' ? { id: e.id as string, module: m.slice(0, 64), error: text(e.error) }
      : { id: e.id as string, error: text(e.error) });
  }
  for (const l of pausedOf ? look : []) {
    const p = enabled(l) && pausedOf!(l);
    if (p && !out.some((e) => e.id === l.id)) out.push({ id: l.id, error: p.error });
  }
  return out.length ? out : NONE;
}

/** Each layer of the look's time this frame, in ms: the worker's, where it is a time. */
export function layerTimes(raw: unknown, look: readonly Layer[]) {
  const out: Record<string, number> = {}, r = object(raw) as Record<string, unknown>;
  for (const l of look) {
    const v = Object.hasOwn(r, l.id) ? r[l.id] : undefined;
    if (time(v)) out[l.id] = v;
  }
  return out;
}

/** The app's frame: the worker's rgb when it is the rig's (count × 3), else black. */
export function frameAnswer(m: FromWorker, seq: number, count: number, look: readonly Layer[], pausedOf: PausedOf) {
  const rgb = m.rgb instanceof Float32Array && m.rgb.length === count * 3 ? m.rgb : new Float32Array(count * 3);
  return { type: 'frame', seq, rgb, errors: frameErrors(m.errors, look, pausedOf), ms: ms(m.ms),
    layerMs: layerTimes(m.layerMs, look) };
}

/** The app's export, or why there is none: channels are exactly `frames` of the rig's frame channels. */
export function renderedAnswer(m: FromWorker, seq: number, frameBytes: number, look: readonly Layer[],
  pausedOf: PausedOf) {
  if (!(m.channels instanceof Uint8Array)) return 'The sandbox returned no channel data.';
  if (m.channels.length !== frameBytes) return 'The sandbox returned the wrong amount of channel data.';
  return { type: 'rendered', seq, channels: m.channels, errors: frameErrors(m.errors, look, pausedOf) };
}

/** The worker's compile report for the look's layers, paused layers in their places. */
export function compiledReport(layers: readonly Layer[], report: unknown, pausedOf: PausedOf,
  schemas: ReadonlyMap<string, object>) {
  const byId = new Map(records(report).map((r) => [r.id, r] as const));
  return layers.map((l) => {
    const p = pausedOf?.(l);
    if (p && p.load) return { id: l.id, ok: false, error: p.error, params: {} };
    if (p) return { id: l.id, ok: true, params: p.params || schemas.get(l.id) || {} };
    const r = byId.get(l.id);
    if (!r) return { id: l.id, ok: false, error: 'The sandbox did not report this layer.', params: {} };
    return { id: l.id, ok: !!r.ok, params: object(r.params),
      modules: records(r.modules).filter((x) => typeof x.id === 'string')
        .map((x) => ({ id: x.id as string, ok: !!x.ok, params: object(x.params),
          ...(x.ok ? { upgraded: x.upgraded } : { error: text(x.error) }) })),
      ...(r.ok ? {} : { error: text(r.error) }) };
  });
}
