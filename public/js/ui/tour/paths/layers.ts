// Layers and chains: where a layer plays, how it meets the ones below, its order, and a module added to its chain.
import { tourName } from '../../tour-view.ts';
import { type Ctx, layerBy, type Path } from '../types.ts';

const top = (c: Ctx) => layerBy(c, 'lighthouse');
const selectedTop = (c: Ctx) => !!c.v && c.v.selected.value?.id === top(c)?.id;
const mirror = (c: Ctx) => top(c)?.modules.find((m) => m.ref === 'mirror') ?? null;

export const layers: Path = {
  id: 'layers', title: 'Layers and chains', minutes: 4, start: '/studio?tour=layers',
  about: 'Where a layer plays, how layers mix, their order, and a module added to a chain.',
  steps: [
    { id: 'select', page: '/studio', title: 'A stack of layers',
      text: 'This practice look has two layers, the top one drawn last. Click {preset:lighthouse} to select it.',
      anchor: ['layers', 'layer:lighthouse'], done: selectedTop },
    { id: 'plays-on', page: '/studio', title: 'Where it plays',
      text: 'Plays on says which parts of the Folly a layer lights. Open it, untick the whole building, then tick '
        + 'the Rose window.',
      anchor: (c) => ['plays-on', ...(c.v?.tagged('rose').slice(0, 1) ?? []).map((g) => `group:${g}`)],
      done: (c) => {
        const g = top(c)?.groups, rose = c.v?.tagged('rose') ?? [];
        return !!g?.length && g.every((x) => rose.includes(x));
      } },
    { id: 'blend', page: '/studio', title: 'How layers mix',
      text: 'Blend says how a layer meets the ones below: Add sums their light, Over covers them. Pick another.',
      anchor: ['blend:lighthouse'], begin: (c) => top(c)?.blend, done: (c, was) => !!top(c) && top(c)!.blend !== was },
    { id: 'level', page: '/studio', title: 'How bright',
      text: 'Level is the layer\'s brightness. Drag it, or type, down to 60 % or less.',
      anchor: ['level:lighthouse'], done: (c) => (top(c)?.level ?? 1) <= 0.6,
      progress: (c) => ({ now: 1 - (top(c)?.level ?? 1), goal: 0.4 }) },
    { id: 'order', page: '/studio', title: 'The order',
      text: '↓ moves the selected layer down the stack, under the ones above it. Move {preset:lighthouse} down.',
      anchor: ['move-layer-down'],
      begin: (c) => c.v?.layers.peek().findIndex((l) => tourName(l.title) === 'lighthouse'),
      done: (c, was) => (c.v?.layers.value.findIndex((l) => l.id === top(c)?.id) ?? -1) < (was as number) },
    { id: 'chain', page: '/studio', title: 'Add to the chain',
      text: 'A layer is a chain of modules, each working on the one before. + Module, then Warps, then '
        + '{module:mirror}.',
      anchor: ['chain-add', 'shelf-tab:warp', 'shelf:mirror'], done: (c) => !!mirror(c) },
    { id: 'off', page: '/studio', title: 'Off, not gone',
      text: 'A module\'s switch turns it off and keeps its settings. Turn {module:mirror} off.',
      anchor: ['module-on:mirror'], done: (c) => mirror(c)?.enabled === false },
    { id: 'soften', page: '/studio', title: 'Soften the edges',
      text: 'Soften blurs a layer across the LEDs round each one. Set it to 10 cm or more.',
      anchor: ['soften'], done: (c) => (top(c)?.soften ?? 0) >= 0.1, next: true,
      progress: (c) => ({ now: top(c)?.soften ?? 0, goal: 0.1 }) },
  ],
};
