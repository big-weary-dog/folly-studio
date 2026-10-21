// From an idea, Rose and arches' second chapter: describe a look, and the tutorial's ready-made one opens in the
// Studio in place of what a model would write (SPEC-tutorial "The idea").
import { type Path } from '../types.ts';

const IDEA = 'The rose window blooms open ring by ring while light runs up the main arches.';
const typed = (el: (name: string) => Element | null) => (el('idea') as HTMLTextAreaElement | null)?.value ?? '';

export const idea: Path = {
  id: 'idea', title: 'From an idea', start: '/ideas', look: '/studio?tour=idea',
  about: 'Describe a look; it opens in the Studio.', aboutPi: 'The look the idea makes, and its layers.',
  steps: [
    { id: 'describe', page: '/ideas', title: 'Describe it',
      text: `The more you say about colour, motion and place, the closer the first draft. Type: "${IDEA}"`,
      anchor: ['idea'], done: ({ el }) => /rose/i.test(typed(el)) && /arch/i.test(typed(el)) },
    { id: 'make', title: 'Make it',
      text: 'A model usually writes the look\'s code, which takes a minute; in the tutorial the look opens at once, '
        + 'ready-made. Click Turn it into a look.',
      idea: '/studio?tour=idea', anchor: ['idea-make'],
      done: ({ v, page }) => page.startsWith('/studio') && !!v?.ready.value
        && ['rose', 'arches'].every((t) => v.layers.value.some((l) => l.title.toLowerCase() === t)) },
    { id: 'layer', page: '/studio', title: 'What it made',
      text: 'Each part of a look is a layer, with its settings on the right. Rose is selected; click Arches.',
      anchor: ['layer:arches'], done: ({ v }) => v?.selected.value?.title === 'Arches', next: true },
  ],
};
