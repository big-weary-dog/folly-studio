// Values that move, Rose and arches' sixth chapter and its advanced one: ∿ hands a value to an LFO (three shapes, on
// three kinds of value), or to a macro, one fader that moves two values together and that the timeline automates.
import { boundTo, type Ctx, on, param, type Path } from '../types.ts';

type Lfo = { shape?: string; rate?: number; unit?: string; center?: number; depth?: number };
/** Param `key` of module `ref` on layer `slug`, when an LFO moves it. */
const lfo = (c: Ctx, slug: string, ref: string, key: string) => {
  const x = param(c, slug, ref, key);
  return boundTo(x) === 'lfo' ? x as Lfo : null;
};
const ends = (l: Lfo | null) => (l ? [(l.center ?? 0) - (l.depth ?? 0), (l.center ?? 0) + (l.depth ?? 0)] : null);
const sky = (c: Ctx) => lfo(c, 'starfield', 'colour-wash', 'brightness');
/** An LFO's seconds a cycle, its rate in cycles a second or (on the beat) a beat. */
const period = (c: Ctx, l: Lfo | null) => (l?.rate ? (l.unit === 'beats' ? 60 / (c.v?.bpm.value ?? 120) : 1) / l.rate
  : 0);
const shift = (c: Ctx) => lfo(c, 'rose', 'hue-shift', 'offset');
const turn = (c: Ctx) => lfo(c, 'rose', 'rotate', 'angle');
/** Param `key` of module `ref` on layer `slug`, then its ∿ drawer's `then`. */
const at = (slug: string, ref: string, key: string, ...then: string[]) => on(slug, ref, `param:${key}`, ...then);
const lanes = (c: Ctx) => Object.keys(c.v?.automation.value ?? {}).length;
const points = (c: Ctx) => Object.values(c.v?.automation.value ?? {}).reduce((a, n) => a + n, 0);
const faders = (c: Ctx) => Object.values(c.v?.macros.value ?? {});

export const moves: Path = {
  id: 'moves', title: 'Values that move', start: '/studio?tour=moves',
  about: 'Advanced: LFOs and their shapes, a macro on two values, and automation.',
  steps: [
    { id: 'lfo', page: '/studio', title: 'An LFO',
      text: '∿ beside a value hands it to something that moves it. An LFO is a wave. Click Starfield, open its '
        + '{module:colour-wash}, then the ∿ beside Brightness, and pick LFO: the sky dims and brightens by itself.',
      anchor: at('starfield', 'colour-wash', 'brightness', 'mod-kinds'), done: (c) => !!sky(c) },
    { id: 'rate', page: '/studio', title: 'Its rate',
      text: 'Rate is how often the wave comes round. With a tempo it counts beats, a bar (4 beats) a wave. Set it to '
        + '16 beats or more (or pick 4 bars), so the sky breathes slowly.',
      anchor: at('starfield', 'colour-wash', 'brightness', 'mod-rate'),
      done: (c) => period(c, sky(c)) >= 10, progress: (c) => ({ now: Math.min(10, period(c, sky(c))), goal: 10 }) },
    { id: 'between', page: '/studio', title: 'Its range',
      text: 'Between is where the wave goes, from its low to its high. Set To to 0.8 or more: the sky swells bright, '
        + 'then sinks back to dark.',
      anchor: at('starfield', 'colour-wash', 'brightness', 'mod-between'),
      done: (c) => (ends(sky(c))?.[1] ?? 0) >= 0.8 },
    { id: 'square', page: '/studio', title: 'A square wave',
      text: 'An LFO\'s shape is how it moves. On Rose, open {module:hue-shift}, the ∿ beside '
        + '{param:hue-shift.offset}, pick LFO, then Square: a square wave jumps between its two ends.',
      anchor: (c) => at('rose', 'hue-shift', 'offset', shift(c) ? 'mod-shape' : 'mod-kinds')(c),
      done: (c) => shift(c)?.shape === 'square' },
    { id: 'off', page: '/studio', title: 'All the way off',
      text: 'Set From to 0, so the shift snaps fully off and back to 0.5: the rose flips between its own colours '
        + 'and their opposites.',
      anchor: at('rose', 'hue-shift', 'offset', 'mod-between'),
      done: (c) => shift(c)?.shape === 'square' && Math.abs(ends(shift(c))?.[0] ?? 1) <= 0.05
        && (ends(shift(c))?.[1] ?? 0) >= 0.45 },
    { id: 'saw', page: '/studio', title: 'A saw wave',
      text: 'A saw climbs steadily and drops back. Still on Rose, open {module:rotate}, the ∿ beside '
        + '{param:rotate.angle}, pick LFO, then Saw: on top of its spin, the rose swings round, then snaps back.',
      anchor: (c) => at('rose', 'rotate', 'angle', turn(c) ? 'mod-shape' : 'mod-kinds')(c),
      done: (c) => turn(c)?.shape === 'saw' },
    { id: 'macro', page: '/studio', title: 'A macro',
      text: 'A macro is one fader that can move several values together, by hand, from the timeline or from Live. '
        + 'In the Look tab, click + Macro.',
      anchor: ['dock:look', 'macro-add'], begin: (c) => faders(c).length,
      done: (c, n) => faders(c).length > (n as number) },
    { id: 'tail', page: '/studio', title: 'Tie a value to it',
      text: 'On Arches, open {module:single-strand}, the ∿ beside {param:single-strand.tail}, then Macro (the new '
        + 'macro is picked): the fader now sets how long the comets\' tails are.',
      anchor: at('arches', 'single-strand', 'tail', 'mod-kinds'),
      done: (c) => boundTo(param(c, 'arches', 'single-strand', 'tail')) === 'global' },
    { id: 'rings', page: '/studio', title: 'Tie another',
      text: 'On Rose, open {module:bars}, the ∿ beside {param:bars.bars}, then Macro: the same fader now sets how '
        + 'many rings the rose has.',
      anchor: at('rose', 'bars', 'bars', 'mod-kinds'),
      done: (c) => boundTo(param(c, 'rose', 'bars', 'bars')) === 'global' },
    { id: 'fader', page: '/studio', title: 'Move the fader',
      text: 'In the Look tab, drag the macro to 1: long tails and many rings, at once.',
      anchor: (c) => ['dock:look', ...Object.keys(c.v?.macros.value ?? {}).slice(0, 1).map((m) => `macro:${m}`)],
      done: (c) => faders(c).some((v) => v >= 0.95) },
    { id: 'automate', page: '/studio', title: 'Automation',
      text: 'A lane moves a macro over time. In the Timeline, pick the macro from + Automate…: its lane holds it '
        + 'where the fader is, from start to end.',
      anchor: ['dock:timeline', 'automate'], begin: lanes, done: (c, n) => lanes(c) > (n as number) },
    { id: 'points', page: '/studio', title: 'Points on the lane',
      text: 'Click the lane twice to add two points: one low near the start, one high later, so the look builds '
        + 'as it plays. Drag a point to move it.',
      anchor: (c) => ['dock:timeline', ...Object.keys(c.v?.automation.value ?? {}).slice(0, 1)
        .map((m) => `lane:${m}`)],
      begin: points, done: (c, n) => points(c) >= (n as number) + 2, next: true },
  ],
};
