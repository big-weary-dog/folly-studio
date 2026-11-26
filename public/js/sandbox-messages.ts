// The worker's answers read as data (SPEC "Sandbox protocol"): pattern code shares the worker's thread and can post
// too, so the runtime takes only what these bound. Pure: what the runtime knows comes in as arguments.
import type { FrameError, ToSandbox } from './runtime.ts';

export type Layer = Extract<ToSandbox, { type: 'look' }>['layers'][number];
/** What the worker says; every field is checked before it is used. */
export type FromWorker = { type: 'ready' | 'compiled' | 'frame' | 'rendered' | 'progress' | 'compiling' | 'error';
  seq?: unknown; done?: unknown; layers?: unknown; rgb?: unknown; errors?: unknown; ms?: unknown;
  layerMs?: unknown; channels?: unknown; request?: unknown; error?: unknown };
type Reported = { id?: unknown; ok?: unknown; error?: unknown; params?: unknown; upgraded?: unknown;
  modules?: unknown };

export const TEXT_MAX = 300;     // an error's characters, as the render box's
// oxlint-disable-next-line no-control-regex -- control characters are what it strips from the worker's text
const CONTROL = /[\u0000-\u001f\u007f]/g;
const NONE: readonly FrameError[] = Object.freeze([]);

/** Text pattern code can set, as one printable line of at most TEXT_MAX characters ('error' for no text). */
export const text = (v: unknown) => (typeof v === 'string' && v ? v.replace(CONTROL, ' ').slice(0, TEXT_MAX) : 'error');
/** A time in ms: finite and ≥ 0. */
export const isTime = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v < Infinity;
const object = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
const records = (v: unknown) => (Array.isArray(v) ? v : []).filter((r) => r && typeof r === 'object') as Reported[];

/** A frame's errors: at most one per layer of the look; no errors is the one frozen empty list. */
export function frameErrors(errors: unknown, look: readonly Layer[]): readonly FrameError[] {
  if (!(Array.isArray(errors) && errors.length)) return NONE;
  const out: FrameError[] = [];
  for (const e of records(errors)) {
    if (!look.some((l) => l.id === e.id) || out.some((o) => o.id === e.id)) continue;
    const m = (e as { module?: unknown }).module;
    out.push(typeof m === 'string' ? { id: e.id as string, module: m.slice(0, 64), error: text(e.error) }
      : { id: e.id as string, error: text(e.error) });
  }
  return out.length ? out : NONE;
}

/** A layer's time this frame from the worker's `layerMs`, or -1 when it gives none. */
export function layerTime(raw: unknown, id: string) {
  const v = raw && typeof raw === 'object' && Object.hasOwn(raw, id) ? object(raw)[id] : -1;
  return isTime(v) ? v : -1;
}

/** A frame's rgb when it is the rig's (count × 3 floats), else `black`. */
export const frameRgb = (rgb: unknown, count: number, black: Float32Array) =>
  (rgb instanceof Float32Array && rgb.length === count * 3 ? rgb : black);

/** An export's channels, exactly `frameBytes` of them, or why there are none. */
export function channelsOf(channels: unknown, frameBytes: number) {
  if (!(channels instanceof Uint8Array)) return 'The sandbox returned no channel data.';
  if (channels.length !== frameBytes) return 'The sandbox returned the wrong amount of channel data.';
  return channels;
}

type Compiled = { id: string; ok: boolean; error?: string; params: Record<string, unknown> };   // params: untrusted
/** A layer's compile report: its own and each module's. */
export type LayerReport = Compiled & { modules: (Compiled & { upgraded?: unknown })[] };

/** The worker's compile report for the look's layers, in their order. */
export function compiledReport(layers: readonly Layer[], report: unknown): LayerReport[] {
  const byId = new Map(records(report).map((r) => [r.id, r] as const));
  return layers.map((l) => {
    const r = byId.get(l.id);
    if (!r) return { id: l.id, ok: false, error: 'The sandbox did not report this layer.', params: {}, modules: [] };
    return { id: l.id, ok: !!r.ok, params: object(r.params),
      modules: records(r.modules).filter((x) => typeof x.id === 'string')
        .map((x) => ({ id: x.id as string, ok: !!x.ok, params: object(x.params),
          ...(x.ok ? { upgraded: x.upgraded } : { error: text(x.error) }) })),
      ...(r.ok ? {} : { error: text(r.error) }) };
  });
}
