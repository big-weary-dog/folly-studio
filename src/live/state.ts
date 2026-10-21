// The live stage's state (SPEC-live "State"): pure functions over it. A push becomes a point in this loop's lane for
// that global or macro, stamped with a show time, so every viewer's core integrates the same lanes to the same
// frame; layer levels and blackout just change. The browser's twin is public/js/ui/live/lanes.ts.
import { automationAt, MAX_LANES, MAX_POINTS, normalizeGlobals, upgradeGlobals } from '../../public/js/pattern-core.ts';
import type { FromClient, Live, LiveLook, LiveUpdate, Points } from '../../shared/schemas/live.ts';

export const LEAD_MS = 30;           // a push plays this long after it arrives, so viewers usually have it in time
export const RAMP = 0.05;            // seconds a pushed value takes to arrive
const ms = (v: number) => Math.round(v * 1000) / 1000;
type Set = Extract<FromClient, { type: 'set' }>;
type By = NonNullable<Live['by']>;
type Range = { min: number, max: number, value: number };

export const emptyLive = (): Live => ({ rev: 0, look: null, startedAt: 0, loop: 0, held: {}, lanes: {}, drop: [],
  layers: {}, blackout: false, by: null, updatedAt: 0, driver: 'stage' });

/** The loop and the show time in it at server time `now` (ms). */
export function showTime(live: Pick<Live, 'look' | 'startedAt'>, now: number) {
  const d = live.look?.duration || 30, tau = Math.max(0, (now - live.startedAt) / 1000), loop = Math.floor(tau / d);
  return { loop, t: tau - loop * d };
}

/** On to `loop`: each lane's last value held, released names dropped, lanes emptied. */
export function roll(live: Live, loop: number) {
  if (loop <= live.loop) return;
  for (const [name, pts] of Object.entries(live.lanes)) live.held[name] = pts[pts.length - 1][1];
  for (const name of live.drop) delete live.held[name];
  Object.assign(live, { lanes: {}, drop: [], loop });
}

/** The look's macros with their ranges and values (upgradeGlobals: energy one on a look from before). */
export function rangesOf(look: Pick<LiveLook, 'globals' | 'automation' | 'layers'>) {
  const g = normalizeGlobals(upgradeGlobals(look).globals);
  return new Map<string, Range>(g.macros.map((m) => [m.name, { min: m.min, max: m.max, value: m.value }]));
}

/** The look's own value of `name` at show time t: its lane there, else its static value. */
const own = (look: LiveLook, name: string, r: Range, t: number) => {
  const lane = look.automation?.[name];
  return lane?.length ? automationAt(lane, t) : r.value;
};

/** This loop's lane for `name`. Made at its first push from the look's own lane, it ends at t on what played then
 * (`fresh`: no push in it yet); a held or static value is one point. */
function laneFor(live: Live, name: string, r: Range, t: number): { pts: Points, fresh: boolean } {
  if (live.lanes[name]) return { pts: live.lanes[name], fresh: false };
  const base = name in live.held ? null : live.look!.automation?.[name];
  if (!base?.length) return { pts: [[0, live.held[name] ?? r.value]], fresh: false };
  const pts: Points = [[0, automationAt(base, 0)]];
  for (const p of base) if (p[0] > 0 && p[0] < t) pts.push([p[0], p[1]]);
  if (ms(t) > pts[pts.length - 1][0]) pts.push([ms(t), automationAt(base, t)]);
  return { pts, fresh: true };
}

/** Push v at show time `at` into a lane: a 50 ms ramp from what plays then; one push within 50 ms moves the last. */
function pushPoint(pts: Points, at: number, v: number, fresh: boolean) {
  const last = pts[pts.length - 1], end = ms(at + RAMP);
  if (pts.length >= MAX_POINTS - 1 || (!fresh && pts.length > 1 && last[0] > at - RAMP)) {
    if (end > last[0]) last[0] = end;
    last[1] = v;
    return;
  }
  if (last[0] < ms(at)) pts.push([ms(at), automationAt(pts, at)]);
  if (end > pts[pts.length - 1][0]) pts.push([end, v]);
}

/** A look switched to: the stage starts it at show time 0, keeping only blackout. */
export function switchTo(live: Live, look: LiveLook, by: By, now: number): Live {
  return { ...emptyLive(), rev: live.rev + 1, look, startedAt: now + LEAD_MS, blackout: live.blackout, by,
    updatedAt: now };
}

/** A controller's `set`, applied to `live` at server time `now` → the update to broadcast, or an error. */
export function applySet(live: Live, msg: Set, by: By, now: number): LiveUpdate | { error: string } {
  const look = live.look;
  if (!look) return { error: 'Nothing is playing: pick a look first.' };
  const ranges = rangesOf(look), lanes: LiveUpdate['lanes'] = {}, ids = new Set(look.layers.map((l) => l.id));
  // Checked whole before anything changes.
  const bad = Object.keys(msg.values ?? {}).find((n) => !ranges.has(n));
  if (bad) return { error: `${bad} is not one of this look's macros.` };
  const noLayer = Object.keys(msg.layers ?? {}).find((id) => !ids.has(id));
  if (noLayer) return { error: `This look has no layer ${noLayer}.` };
  const at = now + LEAD_MS, { loop, t } = showTime(live, at);
  roll(live, loop);
  const names = Object.keys({ ...msg.values }).filter((n) => !(n in live.held) && !look.automation?.[n]);
  const laneCount = new Set([...Object.keys(look.automation ?? {}), ...Object.keys(live.held)]).size;
  if (names.length && laneCount + names.length > MAX_LANES) return { error: `At most ${MAX_LANES} lanes play.` };
  for (const [name, raw] of Object.entries(msg.values ?? {})) {
    const r = ranges.get(name)!;
    const v = Math.min(r.max, Math.max(r.min, raw)), { pts, fresh } = laneFor(live, name, r, t);
    pushPoint(pts, t, v, fresh);
    live.lanes[name] = pts;
    live.held[name] ??= pts[0][1];
    live.drop = live.drop.filter((n) => n !== name);
    lanes[name] = pts;
  }
  for (const name of msg.release ?? []) {
    const r = ranges.get(name);
    if (!r || !(name in live.held) || live.drop.includes(name) || name in (msg.values ?? {})) continue;
    const { pts, fresh } = laneFor(live, name, r, t);
    pushPoint(pts, t, own(look, name, r, t + RAMP), fresh);
    live.lanes[name] = lanes[name] = pts;
    live.drop.push(name);
  }
  for (const [id, set] of Object.entries(msg.layers ?? {})) live.layers[id] = { ...live.layers[id], ...set };
  if (msg.blackout !== undefined) live.blackout = msg.blackout;
  Object.assign(live, { rev: live.rev + 1, by, updatedAt: now });
  return { type: 'update', rev: live.rev, at, loop: live.loop, held: { ...live.held }, drop: [...live.drop], lanes,
    ...(msg.layers ? { layers: live.layers } : {}), ...(msg.blackout !== undefined ? { blackout: live.blackout } : {}),
    by };
}
