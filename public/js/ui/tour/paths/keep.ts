// Keep it, Spire rise's last chapter: an idea tried and undone, save, Live, and the next look described.
import { type Ctx, layerBy, type Path } from '../types.ts';

/** Bars plays somewhere besides the spires. */
const spread = (c: Ctx) => {
  const g = layerBy(c, 'bars')?.groups, spire = c.v?.tagged('spire') ?? [];
  return !g?.length || g.some((x) => !spire.includes(x));
};

export const keep: Path = {
  id: 'keep', title: 'Keep it, show it', start: '/studio?tour=keep',
  about: 'Undo, save, Live, and the next idea.', aboutPi: 'Undo, save and Live.',
  steps: [
    { id: 'try', page: '/studio', title: 'Try an idea',
      text: 'Every edit is kept in History, so trying is safe. Click {module:bars}, open Plays on and tick the whole '
        + 'building, to see the bars on all of the Folly.',
      anchor: ['layer:bars', 'plays-on'], done: spread },
    { id: 'undo', page: '/studio', title: 'Undo',
      text: 'Bars over everything bury the bed. Open History and Undo (or press Ctrl+Z) until they are back on the '
        + 'spires.',
      anchor: ['history', 'undo'], begin: ({ v }) => v?.historyAt.peek(),
      done: (c, at) => (c.v?.historyAt.value ?? 0) < (at as number) && !spread(c) },
    { id: 'save', page: '/studio', title: 'Save',
      text: 'Save keeps Spire rise in My looks as your own; the practice copy changed nothing of yours. Click Save.',
      anchor: ['save'], done: ({ v }) => !!v?.lookId.value && !v.dirty.value },
    { id: 'live', title: 'Live',
      text: 'Live is what the Folly plays now, and what is lined up next. Open it.',
      anchor: ['nav:live'], done: ({ page }) => page.startsWith('/live') },
    { id: 'idea', page: '/ideas', title: 'Describe an idea',
      text: 'Describing an idea writes a new look\'s code for you to edit in the Studio. Type the next one: "Dawn '
        + 'over the spires: the bed warms to gold and the bars slow down". A locked account needs its invite code, in '
        + 'the box below.',
      anchor: ['idea'], done: ({ el }) => /dawn/i.test((el('idea') as HTMLTextAreaElement | null)?.value ?? ''),
      next: true },
  ],
};
