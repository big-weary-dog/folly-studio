// Keep it: undo, save, Live, and an idea described. The last step is where a look of the person's own begins.
import { type Path } from '../types.ts';

export const keep: Path = {
  id: 'keep', title: 'Keep it, show it', start: '/studio?tour=keep',
  about: 'Undo, save, Live, and an idea of your own.', aboutPi: 'Undo, save and Live.',
  steps: [
    { id: 'edit', page: '/studio', title: 'Change something',
      text: 'Change anything, like a layer\'s level.', anchor: ['layers'],
      done: ({ v }) => !!v?.dirty.value },
    { id: 'undo', page: '/studio', title: 'Step back',
      text: 'Open History and Undo (or Ctrl+Z).', anchor: ['history', 'undo'],
      begin: ({ v }) => v?.historyAt.peek(), done: ({ v }, at) => (v?.historyAt.value ?? 0) < (at as number) },
    { id: 'save', page: '/studio', title: 'Save',
      text: 'Save keeps this look in My looks.', anchor: ['save'],
      done: ({ v }) => !!v?.lookId.value && !v.dirty.value },
    { id: 'live', title: 'Live',
      text: 'Live is what the Folly plays now, and what is lined up. Open it.',
      anchor: ['nav:live'], done: ({ page }) => page.startsWith('/live') },
    { id: 'idea', page: '/ideas', title: 'Describe an idea',
      text: 'Describe a show idea, or click an example. Turn it into a look writes its code and opens it in the '
        + 'Studio. A locked account needs its invite code, in the box below.',
      anchor: ['idea'], done: ({ el }) => !!(el('idea') as HTMLTextAreaElement | null)?.value.trim(), next: true },
  ],
};
