// Keep it, Rose and arches' last chapter: an idea tried and undone, save, and Live.
import { type Ctx, layerBy, on, type Path } from '../types.ts';

/** Arches plays somewhere besides the arches. */
const spread = (c: Ctx) => {
  const g = layerBy(c, 'arches')?.groups, arch = [...c.v?.tagged('arch-main') ?? [], ...c.v?.tagged('arch-mini') ?? []];
  return !g?.length || g.some((x) => !arch.includes(x));
};

export const keep: Path = {
  id: 'keep', title: 'Keep it, show it', start: '/studio?tour=keep',
  about: 'Undo, save and Live.',
  steps: [
    { id: 'try', page: '/studio', title: 'Try an idea',
      text: 'Every edit is kept in History, so trying is safe. Click Arches, open Plays on and tick the whole '
        + 'building, to see the comets on all of the Folly.',
      anchor: on('arches', null, 'plays-on'), done: spread },
    { id: 'undo', page: '/studio', title: 'Undo',
      text: 'Comets everywhere drown the rose. Open History and Undo (or press Ctrl+Z) until they are back on the '
        + 'arches.',
      anchor: ['history', 'undo'], begin: ({ v }) => v?.historyAt.peek(),
      done: (c, at) => (c.v?.historyAt.value ?? 0) < (at as number) && !spread(c) },
    { id: 'save', page: '/studio', title: 'Save',
      text: 'Save keeps Rose and arches in My looks as your own; the practice copy changed nothing of yours. Click '
        + 'Save.',
      anchor: ['save'], done: ({ v }) => !!v?.lookId.value && !v.dirty.value },
    { id: 'live', title: 'Live',
      text: 'Live is what the Folly plays now, and what is lined up next. Open it.',
      anchor: ['nav:live'], done: ({ page }) => page.startsWith('/live'), next: true },
  ],
};
