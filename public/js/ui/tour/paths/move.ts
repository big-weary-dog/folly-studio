// Movement and time: play and pause, a value that moves by itself or with the beat, the tempo, a clip, automation.
import { boundTo, type Ctx, layerBy, type Path } from '../types.ts';

const onBars = (c: Ctx) => c.v?.module.value?.ref === 'bars' && c.v.selected.value?.id === layerBy(c, 'plasma')?.id;
const points = (c: Ctx) => Object.values(c.v?.automation.value ?? {}).reduce((a, n) => a + n, 0);

export const move: Path = {
  id: 'move', title: 'Movement and time', start: '/studio?tour=move',
  about: 'Play, tempo, values that move, clips and automation.',
  steps: [
    { id: 'play', page: '/studio', title: 'Play and pause',
      text: 'Click ▶ to pause the look. Space works too.',
      anchor: ['play'], begin: (c) => c.v?.playing.peek(), done: (c, was) => !!c.v && c.v.playing.value !== was },
    { id: 'bars', page: '/studio', title: 'Find the bars',
      text: 'Click {preset:plasma}, then {module:bars}.', anchor: ['layer:plasma', 'module:bars'],
      done: onBars },
    { id: 'lfo', page: '/studio', title: 'A value that moves',
      text: 'Click the ∿ at the end of {param:bars.bars} and pick LFO.',
      anchor: ['param:bars'], done: (c) => onBars(c) && !!boundTo(c.v!.params.value.bars)
        && boundTo(c.v!.params.value.bars) !== 'beats' },
    { id: 'bpm', page: '/studio', title: 'The tempo',
      text: 'In the Timeline, set BPM to 120.', anchor: ['dock:timeline', 'bpm'],
      done: (c) => c.v?.bpm.value === 120 },
    { id: 'clock', page: '/studio', title: 'On the beat',
      text: 'Click the clock beside {param:bars.speed} to keep it on the beat.',
      anchor: ['param:speed'], done: (c) => onBars(c) && boundTo(c.v!.params.value.speed) === 'beats' },
    { id: 'clip', page: '/studio', title: 'A clip',
      text: 'A clip plays a layer for part of the look. Click + Clip.',
      anchor: ['dock:timeline', 'clip-add'], begin: (c) => c.v?.selected.peek()?.clips ?? 0,
      done: (c, n) => (c.v?.selected.value?.clips ?? 0) > (n as number) },
    { id: 'automate', page: '/studio', title: 'Automation',
      text: 'Pick a macro from + Automate…, then click its lane to add a point.',
      anchor: ['dock:timeline', 'automate'], begin: points, done: (c, n) => points(c) > (n as number), next: true },
  ],
};
