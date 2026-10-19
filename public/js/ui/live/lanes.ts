// The live stage's state on a viewer (SPEC-live "State"): show time, rolling over, updates, and what the sandbox
// plays. The server's twin is src/live/state.ts (showTime and roll the same, held to each other by test/live.test.ts).
import type { Automation } from '../../../../shared/schemas/look.ts';
import type { Live, LiveUpdate } from '../../../../shared/schemas/live.ts';
import { automationAt, GLOBALS, normalizeGlobals } from '../../pattern-core.ts';

/** The loop and the show time in it at server time `now` (ms). */
export function showTime(live: Pick<Live, 'look' | 'startedAt'>, now: number) {
  const d = live.look?.duration || 30, tau = Math.max(0, (now - live.startedAt) / 1000), loop = Math.floor(tau / d);
  return { loop, t: tau - loop * d };
}

/** On to `loop`: each lane's last value held, released names dropped, lanes emptied. */
export function roll(live: Live, loop: number) {
  if (loop <= live.loop) return false;
  for (const [name, pts] of Object.entries(live.lanes)) live.held[name] = pts[pts.length - 1][1];
  for (const name of live.drop) delete live.held[name];
  Object.assign(live, { lanes: {}, drop: [], loop });
  return true;
}

/** An update's lanes, held values and author, now (layers and blackout wait for its `at`); false: out of order. */
export function applyUpdate(live: Live, u: LiveUpdate) {
  if (u.rev !== live.rev + 1) return false;
  roll(live, u.loop);
  for (const [name, pts] of Object.entries(u.lanes)) {
    if (pts) live.lanes[name] = pts; else delete live.lanes[name];
  }
  Object.assign(live, { rev: u.rev, held: u.held, drop: u.drop, by: u.by });
  return true;
}

/** The look's automation with each held name's live lane (or its held value) in place of its own. */
export function stageAutomation(live: Live): Automation {
  const out: Automation = { ...live.look?.automation };
  for (const [name, v] of Object.entries(live.held)) out[name] = live.lanes[name] ?? [[0, v]];
  return out;
}

export type Control = { name: string, min: number, max: number, value: number, held: boolean };
/** The faders a look offers: the globals, then its macros, each with its value at show time t. */
export function controlsOf(live: Live, t: number): Control[] {
  if (!live.look) return [];
  const g = normalizeGlobals(live.look.globals), auto = stageAutomation(live);
  const list = [...Object.entries(GLOBALS).map(([name, r]) => ({ name, min: r.min, max: r.max,
    value: g[name as keyof typeof GLOBALS] })), ...g.macros.map((m) => ({ ...m }))];
  return list.map((c) => {
    const lane = auto[c.name];
    return { ...c, value: lane?.length ? automationAt(lane, t) : c.value, held: c.name in live.held };
  });
}
