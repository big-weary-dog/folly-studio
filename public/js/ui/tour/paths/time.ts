// Time, Rose and arches' fifth chapter: the tempo, a speed on the beat, and a clip.
import { boundTo, type Ctx, layerBy, on, param, type Path } from '../types.ts';

const arches = (c: Ctx) => layerBy(c, 'arches');

export const time: Path = {
  id: 'time', title: 'Time', start: '/studio?tour=time',
  about: 'The tempo, the beat, and a clip.',
  steps: [
    { id: 'bpm', page: '/studio', title: 'The tempo',
      text: 'BPM is the look\'s tempo, the one everything on the beat follows. In the Timeline, set BPM to 90.',
      anchor: ['dock:timeline', 'bpm'], done: ({ v }) => v?.bpm.value === 90 },
    { id: 'clock', page: '/studio', title: 'On the beat',
      text: 'The clock counts a speed in beats instead of seconds. On Arches, click the clock beside '
        + '{param:single-strand.speed}, so the comets keep time with the tempo.',
      anchor: on('arches', 'single-strand', 'param:speed'),
      done: (c) => boundTo(param(c, 'arches', 'single-strand', 'speed')) === 'beats' },
    { id: 'clip', page: '/studio', title: 'A clip',
      text: 'A clip plays a layer for part of the look. With Arches selected, click + Clip: the arches now come in '
        + 'after the rose has opened.',
      anchor: on('arches', null, 'clip-add'), begin: (c) => arches(c)?.clips ?? 0,
      done: (c, n) => (arches(c)?.clips ?? 0) > (n as number), next: true },
  ],
};
