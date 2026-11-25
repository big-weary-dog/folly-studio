// A bug report's captured Studio, as the replay sets it (report-studio.ts): an account sent it, so each piece is
// checked and bounded here, and one that does not fit is left as the admin's own (undefined).
import { QUALITY } from '../studio/preview.ts';
import { type Dock, type SideView, TABS } from '../studio/store.ts';
import { MAX_PPS } from '../timeline/state.ts';

const MAX_IDS = 500, MAX_ID = 200, MAX_SECONDS = 600;
const DOCKS: readonly Dock[] = ['timeline', 'look'], SIDES: readonly SideView[] = ['split', 'layers', 'params'];
const MODES = ['playa', 'points'] as const;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {});
const str = (v: unknown, max = MAX_ID) => (typeof v === 'string' && v.length <= max ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const num = (v: unknown, min: number, max: number) =>
  (typeof v === 'number' && v >= min && v <= max ? v : undefined);
const oneOf = <T>(v: unknown, of: readonly T[]) => (of.includes(v as T) ? v as T : undefined);
const ids = (v: unknown) => (Array.isArray(v)
  ? new Set(v.slice(0, MAX_IDS).filter((x): x is string => str(x) !== undefined)) : undefined);
const picks = (v: unknown): Record<string, string> | undefined => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).slice(0, MAX_IDS).filter(([k, x]) => str(k) && str(x) !== undefined))
  : undefined);
const layerOf = (v: unknown) => (v === null ? null : str(v));
function timelineSel(v: unknown) {
  if (v === null) return null;
  const { id, index } = obj(v);
  return str(id) !== undefined && Number.isInteger(index) && (index as number) >= 0
    ? { id: id as string, index: index as number } : undefined;
}

/** The captured Studio (the report's `sources.studio`), or null when it holds no draft to open. */
export function parseCaptured(raw: unknown) {
  const c = obj(raw), d = obj(c.draft);
  if (!Array.isArray(d.layers)) return null;
  const s = obj(c.selection), lay = obj(c.layout), tl = obj(c.timeline), clock = obj(c.clock), p = obj(c.preview);
  return {
    draft: d,
    selection: { layer: layerOf(s.layer), picked: picks(s.picked), muted: ids(s.muted), solo: ids(s.solo) },
    layout: { dock: oneOf(lay.dock, DOCKS), tab: oneOf(lay.tab, TABS), side: oneOf(lay.side, SIDES),
      folded: bool(lay.folded) },
    timeline: { sel: timelineSel(tl.sel), fit: bool(tl.fit), zoomPps: num(tl.zoomPps, Number.MIN_VALUE, MAX_PPS) },
    clock: { t: num(clock.t, 0, MAX_SECONDS) ?? 0, speed: num(clock.speed, 0.25, 4) ?? 1, baked: clock.baked === true },
    preview: { view: str(p.view, 64), mode: oneOf(p.mode, MODES), quality: oneOf(p.quality, QUALITY),
      venue: bool(p.venue) },
  };
}
export type Captured = NonNullable<ReturnType<typeof parseCaptured>>;
