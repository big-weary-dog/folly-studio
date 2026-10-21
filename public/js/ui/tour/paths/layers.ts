// Layers and chains: where a layer plays, how it meets the ones below, its order, and a module added to its chain.
import { tourName } from '../../tour-view.ts';
import { type Ctx, layerBy, type Path } from '../types.ts';

const top = (c: Ctx) => layerBy(c, 'lighthouse');
const selectedTop = (c: Ctx) => !!c.v && c.v.selected.value?.id === top(c)?.id;
const mirror = (c: Ctx) => top(c)?.modules.find((m) => m.ref === 'mirror') ?? null;

export const layers: Path = {
  id: 'layers', title: 'Layers and chains', start: '/studio?tour=layers',
  about: 'Where a layer plays, how layers mix, and their order.',
  steps: [
    { id: 'select', page: '/studio', title: 'A stack of layers',
      text: 'Click {preset:lighthouse}, the top layer.',
      anchor: ['layers', 'layer:lighthouse'], done: selectedTop },
    { id: 'plays-on', page: '/studio', title: 'Where it plays',
      text: 'Open Plays on, untick the whole building, then tick the Rose window.',
      anchor: (c) => ['plays-on', ...(c.v?.tagged('rose').slice(0, 1) ?? []).map((g) => `group:${g}`)],
      done: (c) => {
        const g = top(c)?.groups, rose = c.v?.tagged('rose') ?? [];
        return !!g?.length && g.every((x) => rose.includes(x));
      } },
    { id: 'blend', page: '/studio', title: 'How layers mix',
      text: 'Blend is how a layer mixes with the ones below. Pick another.',
      anchor: ['blend:lighthouse'], begin: (c) => top(c)?.blend, done: (c, was) => !!top(c) && top(c)!.blend !== was },
    { id: 'level', page: '/studio', title: 'How bright',
      text: 'Set Level to 60 % or less.',
      anchor: ['level:lighthouse'], done: (c) => (top(c)?.level ?? 1) <= 0.6,
      progress: (c) => ({ now: 1 - (top(c)?.level ?? 1), goal: 0.4 }) },
    { id: 'order', page: '/studio', title: 'The order',
      text: 'Click ↓ to move {preset:lighthouse} down.',
      anchor: ['move-layer-down'],
      begin: (c) => c.v?.layers.peek().findIndex((l) => tourName(l.title) === 'lighthouse'),
      done: (c, was) => (c.v?.layers.value.findIndex((l) => l.id === top(c)?.id) ?? -1) < (was as number) },
    { id: 'chain', page: '/studio', title: 'Add to the chain',
      text: 'Click + Module, then Warps, then {module:mirror}.',
      anchor: ['chain-add', 'shelf-tab:warp', 'shelf:mirror'], done: (c) => !!mirror(c) },
    { id: 'off', page: '/studio', title: 'Off, not gone',
      text: 'Turn {module:mirror} off with its switch. Its settings stay.',
      anchor: ['module-on:mirror'], done: (c) => mirror(c)?.enabled === false },
    { id: 'soften', page: '/studio', title: 'Soften the edges',
      text: 'Set Soften to 10 cm or more.',
      anchor: ['soften'], done: (c) => (top(c)?.soften ?? 0) >= 0.1, next: true,
      progress: (c) => ({ now: top(c)?.soften ?? 0, goal: 0.1 }) },
  ],
};
