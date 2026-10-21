// Colour: a module's colours picked from the palette, the Look tab, and the palette every layer shares.
import { type Path } from '../types.ts';

export const colour: Path = {
  id: 'colour', title: 'Colour', start: '/studio?tour=colour',
  about: 'A module\'s colours and the look\'s palette.',
  steps: [
    { id: 'bars', page: '/studio', title: 'Find the colours',
      text: 'This is {preset:lighthouse}, with {module:bars} open. Its settings are on the right.',
      anchor: ['layer:lighthouse', 'module:bars'],
      done: ({ v }) => v?.module.value?.ref === 'bars', next: true },
    { id: 'pick', page: '/studio', title: 'Pick colours',
      text: 'Click {param:bars.colours} and choose others.',
      anchor: ['param:colours'], begin: ({ v }) => JSON.stringify(v?.params.peek().colours),
      done: ({ v }, was) => v?.module.value?.ref === 'bars' && JSON.stringify(v.params.value.colours) !== was },
    { id: 'look', page: '/studio', title: 'The whole look',
      text: 'Open the Look tab.', anchor: ['dock:look'],
      done: ({ v }) => v?.dock.value === 'look' },
    { id: 'palette', page: '/studio', title: 'The palette',
      text: 'Pick another palette. Every colour in the look follows.', anchor: ['palette'],
      begin: ({ v }) => v?.palette.peek(), done: ({ v }, was) => !!v && v.palette.value !== was, next: true },
  ],
};
