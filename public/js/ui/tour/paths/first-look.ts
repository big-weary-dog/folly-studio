// Getting around, the tutorial's one path (SPEC-tutorial), on Rose and arches: play, a layer, a colour, mute and
// save, each a control the Studio's Simple view shows.
import { type Ctx, layerBy, on, param, type Path, tokens, twice } from '../types.ts';

const colours = (c: Ctx) => tokens(param(c, 'arches', 'single-strand', 'colours'));
const star = (c: Ctx) => layerBy(c, 'starfield');

export const guestKeep = {
  id: 'save', page: '/studio', title: 'Keep your work',
  text: 'Your work stays in this browser. Save asks you to log in or sign up for an account, then your work '
    + 'comes with you. You can keep exploring as a guest. Click Finish.',
  anchor: ['save'], done: () => true, next: true,
};

export const firstLook: Path = {
  id: 'first-look', title: 'Getting around', start: '/studio?tour=first-look',
  about: 'Play, a layer, a colour, mute and save.',
  steps: [
    { id: 'pause', page: '/studio', title: 'Pause and play',
      text: 'Pause freezes a moment to study. Click ▶ (or press Space) to pause, then again to play.',
      anchor: ['play'],
      ...twice(({ v }) => v?.playing.value === false, ({ v }) => v?.playing.value === true) },
    { id: 'layer', page: '/studio', title: 'Its layers',
      text: 'Rose and arches blooms the rose window ring by ring while comets run up the arches. Each part of a look '
        + 'is a layer, with its settings on the right. Click Arches.',
      anchor: ['layer:arches'], done: ({ v }) => v?.selected.value?.title === 'Arches' },
    { id: 'high', page: '/studio', title: 'A colour',
      text: '{param:single-strand.colours} picks from the look\'s palette by role. Click it and tick high: the '
        + 'brightest colours make the comets stand out against the rose.',
      anchor: on('arches', 'single-strand', 'param:colours'),
      done: (c) => colours(c).includes('high') && !colours(c).includes('all') },
    { id: 'mute', page: '/studio', title: 'Mute',
      text: 'Mute silences a layer without removing it. Click M on the Starfield to see the look without it, then '
        + 'again to bring it back.',
      anchor: ['mute:starfield'], ...twice((c) => !!star(c)?.muted, (c) => !!star(c) && !star(c)!.muted) },
    { id: 'save', page: '/studio', title: 'Save',
      text: 'Save keeps Rose and arches in My looks as your own. Click Save.',
      anchor: ['save'], done: ({ v }) => !!v?.lookId.value && !v.dirty.value, next: true },
  ],
};
