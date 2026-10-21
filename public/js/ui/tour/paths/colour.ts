// Colour: a module's colours picked from the palette, the Look tab, and the palette every layer shares.
import { type Path } from '../types.ts';

export const colour: Path = {
  id: 'colour', title: 'Colour', minutes: 2, start: '/studio?tour=colour',
  about: 'A module\'s colours, the Look tab, and the palette they all come from.',
  steps: [
    { id: 'bars', page: '/studio', title: 'Find the colours',
      text: 'Click {preset:lighthouse}, then its {module:bars} module.', anchor: ['layer:lighthouse', 'module:bars'],
      done: ({ v }) => v?.module.value?.ref === 'bars' },
    { id: 'pick', page: '/studio', title: 'Pick colours',
      text: '{param:bars.colours} picks from the look\'s palette, so the look stays in one key. Click it and choose '
        + 'others.',
      anchor: ['param:colours'], begin: ({ v }) => JSON.stringify(v?.params.peek().colours),
      done: ({ v }, was) => v?.module.value?.ref === 'bars' && JSON.stringify(v.params.value.colours) !== was },
    { id: 'look', page: '/studio', title: 'The whole look',
      text: 'What every layer shares is in the Look tab. Open it.', anchor: ['dock:look'],
      done: ({ v }) => v?.dock.value === 'look' },
    { id: 'palette', page: '/studio', title: 'The palette',
      text: 'Pick another palette: every colour in the look changes with it.', anchor: ['palette'],
      begin: ({ v }) => v?.palette.peek(), done: ({ v }, was) => !!v && v.palette.value !== was, next: true },
  ],
};
