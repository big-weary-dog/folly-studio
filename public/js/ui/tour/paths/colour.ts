// Colour, Spire rise's second chapter: a module's colours by palette role, the Look tab, and the palette.
import { param, type Path, tokens } from '../types.ts';

export const colour: Path = {
  id: 'colour', title: 'Colour', start: '/studio?tour=colour',
  about: 'Colours by palette role, and the look\'s palette.',
  steps: [
    { id: 'low', page: '/studio', title: 'A module\'s colours',
      text: 'A module\'s Colours picks from the look\'s palette by role. Click '
        + '{param:colour-wash.colours} and tick low: the palette\'s deepest colours keep the bed dark behind what goes '
        + 'on top.',
      anchor: ['param:colours'],
      done: (c) => { const t = tokens(param(c, 'colour-wash', 'colour-wash', 'colours'));
        return t.includes('low') && !t.includes('all'); } },
    { id: 'look', page: '/studio', title: 'The Look tab',
      text: 'Settings for the whole look, not one layer, live in the Look tab. Open it.', anchor: ['dock:look'],
      done: ({ v }) => v?.dock.value === 'look' },
    { id: 'palette', page: '/studio', title: 'The palette',
      text: 'Every colour in the look comes from its palette. Pick Ocean, and the bed turns deep blue.',
      anchor: ['palette'], done: ({ v }) => v?.palette.value === 'ocean', next: true },
  ],
};
