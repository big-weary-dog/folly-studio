// Keep it: undo, save, Live, and an idea described. The last step is where a look of the person's own begins.
import { type Path } from '../types.ts';

export const keep: Path = {
  id: 'keep', title: 'Keep it, show it', minutes: 3, start: '/studio?tour=keep',
  about: 'Undo and History, saving, Live, and describing an idea of your own.',
  steps: [
    { id: 'edit', page: '/studio', title: 'Change something',
      text: 'Change anything you like: a layer\'s level, a module\'s value.', anchor: ['layers'],
      done: ({ v }) => !!v?.dirty.value },
    { id: 'undo', page: '/studio', title: 'Step back',
      text: 'History lists each edit as a step. Open it and Undo (or Ctrl+Z).', anchor: ['history', 'undo'],
      begin: ({ v }) => v?.historyAt.peek(), done: ({ v }, at) => (v?.historyAt.value ?? 0) < (at as number) },
    { id: 'save', page: '/studio', title: 'Save',
      text: 'This practice look is not saved yet. Save keeps it in My looks, as your own.', anchor: ['save'],
      done: ({ v }) => !!v?.lookId.value && !v.dirty.value },
    { id: 'live', title: 'Live',
      text: 'Live is where the Folly plays for real: the show running now, and the looks lined up for it. Open it.',
      anchor: ['nav:live'], done: ({ page }) => page.startsWith('/live') },
    { id: 'idea', page: '/ideas', title: 'Describe an idea',
      text: 'Write a show idea in a sentence or two, or click an example. Turn it into a look writes its pattern '
        + 'code and opens it in the Studio, where all of this works on it. A locked account unlocks with the '
        + 'invite code it was given, in the box below.',
      anchor: ['idea'], done: ({ el }) => !!(el('idea') as HTMLTextAreaElement | null)?.value.trim(), next: true },
  ],
};
