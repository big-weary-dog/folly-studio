// The look, Rose and arches' second chapter: the look the chapters build, and its layers.
import { type Path } from '../types.ts';

export const look: Path = {
  id: 'look', title: 'The look', start: '/studio?tour=look',
  about: 'The look these chapters build, and its layers.',
  steps: [
    { id: 'layer', page: '/studio', title: 'Its layers',
      text: 'Rose and arches will bloom the rose window ring by ring while comets run up the arches. Each part of a '
        + 'look is a layer, with its settings on the right. Rose is selected; click Arches.',
      anchor: ['layer:arches'], done: ({ v }) => v?.selected.value?.title === 'Arches', next: true },
  ],
};
