// Modules and colour, Rose and arches' third chapter: a number, a choice, Soften and colours on the arches' source,
// then the look's palette.
import { type Ctx, layerBy, num, on, param, type Path, tokens } from '../types.ts';

const strand = (c: Ctx, key: string) => param(c, 'arches', 'single-strand', key);
const speed = (c: Ctx) => num(strand(c, 'speed'));

export const modules: Path = {
  id: 'modules', title: 'Modules and colour', start: '/studio?tour=modules',
  about: 'A module\'s numbers, choices and colours, and the palette.',
  steps: [
    { id: 'speed', page: '/studio', title: 'A number',
      text: 'Arches is drawn by {module:single-strand}, a source: a module that draws light. Set its '
        + '{param:single-strand.speed} to 8 or less, so the bands are easy to follow round the arch.',
      anchor: on('arches', 'single-strand', 'param:speed'), done: (c) => (speed(c) ?? 20) <= 8,
      progress: (c) => ({ now: 20 - Math.min(20, Math.max(8, speed(c) ?? 20)), goal: 12 }) },
    { id: 'comet', page: '/studio', title: 'A choice',
      text: 'Set {param:single-strand.profile} to Comet: each band becomes a bright head with a fading tail, so the '
        + 'light reads as running up the arch.',
      anchor: on('arches', 'single-strand', 'param:profile'), done: (c) => strand(c, 'profile') === 'comet' },
    { id: 'crisp', page: '/studio', title: 'Sharper comets',
      text: 'Soften blurs a layer after its modules, and new layers start a little soft. Turn it down to 0: each '
        + 'comet\'s head goes crisp and its tail reads clearly behind it.',
      anchor: on('arches', null, 'soften'), done: (c) => layerBy(c, 'arches')?.soften === 0 },
    { id: 'high', page: '/studio', title: 'A colour',
      text: '{param:single-strand.colours} picks from the look\'s palette by role. Click it and tick high: the '
        + 'brightest colours make the comets stand out against the rose.',
      anchor: on('arches', 'single-strand', 'param:colours'),
      done: (c) => { const t = tokens(strand(c, 'colours')); return t.includes('high') && !t.includes('all'); } },
    { id: 'look', page: '/studio', title: 'The Look tab',
      text: 'Settings for the whole look, not one layer, are in the Look tab. Open it.', anchor: ['dock:look'],
      done: ({ v }) => v?.dock.value === 'look' },
    { id: 'palette', page: '/studio', title: 'The palette',
      text: 'Every colour in the look comes from its palette. Pick Ocean: the rose and the arches turn to deep blue '
        + 'and teal at once.',
      anchor: ['palette'], done: ({ v }) => v?.palette.value === 'ocean', next: true },
  ],
};
