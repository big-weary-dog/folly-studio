// Movement and time, Spire rise's fourth chapter: focus on the bars, then the tempo, values that move, a macro the
// timeline automates, and a clip.
import { boundTo, type Ctx, layerBy, param, type Path, twice } from '../types.ts';

const bars = (c: Ctx) => layerBy(c, 'bars');
const points = (c: Ctx) => Object.values(c.v?.automation.value ?? {}).reduce((a, n) => a + n, 0);

export const move: Path = {
  id: 'move', title: 'Movement and time', start: '/studio?tour=move',
  about: 'Focus, the tempo, values that move, automation and clips.',
  steps: [
    { id: 'focus', page: '/studio', title: 'Focus',
      text: 'The bars are what this chapter moves, so watch them alone: click S on {module:bars}.',
      anchor: ['solo:bars'], done: (c) => !!bars(c)?.solo },
    { id: 'view', page: '/studio', title: 'Close in',
      text: 'Put the camera on the spires, where the bars climb: click Spire.',
      anchor: ['view-bar', 'view:spire'], done: ({ v }) => v?.view.value === 'spire' },
    { id: 'pause', page: '/studio', title: 'Pause and play',
      text: 'Pause freezes the look so you can study one moment. Click ▶ (or press Space) to pause, then again to '
        + 'play.',
      anchor: ['play'], ...twice(({ v }) => v?.playing.value === false, ({ v }) => v?.playing.value === true) },
    { id: 'bpm', page: '/studio', title: 'The tempo',
      text: 'BPM is the look\'s tempo, the one everything on the beat follows. In the Timeline, set BPM to 90.',
      anchor: ['dock:timeline', 'bpm'], done: ({ v }) => v?.bpm.value === 90 },
    { id: 'clock', page: '/studio', title: 'On the beat',
      text: 'The clock counts a speed in beats instead of seconds. Click the clock beside {param:bars.speed}, so a '
        + 'bar rises on every beat.',
      anchor: ['layer:bars', 'param:speed'], done: (c) => boundTo(param(c, 'bars', 'bars', 'speed')) === 'beats' },
    { id: 'lfo', page: '/studio', title: 'A value that moves',
      text: '∿ lets a value move by itself. Click the ∿ at the end of {param:bars.duty} and pick LFO: the bars swell '
        + 'and thin as they rise.',
      anchor: ['layer:bars', 'param:duty'], done: (c) => boundTo(param(c, 'bars', 'bars', 'duty')) === 'lfo' },
    { id: 'whole', page: '/studio', title: 'The whole building',
      text: 'Back to everything, with the bed and the sparkles: click S on {module:bars} again, then Fit.',
      anchor: (c) => (bars(c)?.solo ? ['solo:bars'] : ['view-bar', 'view:fit']),
      done: (c) => !!bars(c) && !bars(c)!.solo && c.v?.view.value === 'fit' },
    { id: 'macro', page: '/studio', title: 'A macro',
      text: 'A macro is one fader for the whole look, which the timeline and Live can move. In the Look tab, click '
        + '+ Macro.',
      anchor: ['dock:look', 'macro-add'], begin: ({ v }) => v?.macros.peek().length ?? 0,
      done: ({ v }, n) => (v?.macros.value.length ?? 0) > (n as number) },
    { id: 'tie', page: '/studio', title: 'Tie a value to it',
      text: 'Click {module:sparkle}, then the ∿ at the end of {param:sparkle.density}, Macro, and the new macro: it '
        + 'now sets how many glints there are.',
      anchor: ['layer:sparkle', 'param:density'],
      done: (c) => boundTo(param(c, 'sparkle', 'sparkle', 'density')) === 'global' },
    { id: 'automate', page: '/studio', title: 'Automation',
      text: 'A lane moves a macro over time. In the Timeline, pick the macro from + Automate…, then click its lane '
        + 'twice: low near the start and high later, so the glitter builds up.',
      anchor: ['dock:timeline', 'automate'], begin: points, done: (c, n) => points(c) >= (n as number) + 2 },
    { id: 'clip', page: '/studio', title: 'A clip',
      text: 'A clip plays a layer for part of the look. Click {module:bars}, then + Clip: the bars come in once the '
        + 'bed and the glitter have set the scene.',
      anchor: ['layer:bars', 'clip-add'], begin: (c) => bars(c)?.clips ?? 0,
      done: (c, n) => (bars(c)?.clips ?? 0) > (n as number), next: true },
  ],
};
