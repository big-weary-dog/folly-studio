// Layers and chains, Spire rise's third chapter: a layer from a source, where it plays, the camera on it, a chain of
// source, warp and filter, how it meets the bed, and a third layer under it.
import { type Ctx, layerBy, num, param, type Path, tokens, twice } from '../types.ts';

const bars = (c: Ctx) => layerBy(c, 'bars');
const has = (c: Ctx, ref: string) => !!bars(c)?.modules.some((m) => m.ref === ref);
const twist = (c: Ctx) => bars(c)?.modules.find((m) => m.ref === 'twist') ?? null;
const index = (c: Ctx, slug: string) => c.v?.layers.value.findIndex((l) => l.id === layerBy(c, slug)?.id) ?? -1;
/** + Add › Blank › `name`: a new layer from one source. */
const addLayer = (name: string) => ['layers-add', 'shelf-tab:blank', `shelf:${name}`];
/** + Module › `tab` › `name`, on Bars. */
const addModule = (tab: string, name: string) => ['chain-add', `shelf-tab:${tab}`, `shelf:${name}`];

export const layers: Path = {
  id: 'layers', title: 'Layers and chains', start: '/studio?tour=layers',
  about: 'Layers, where they play, the camera, and chains of modules.',
  steps: [
    { id: 'bars', page: '/studio', title: 'A new layer from a source',
      text: 'Each layer is its own pattern, stacked on the ones below, and starts from a source. Click + Add, then '
        + 'Blank, then {module:bars}: bands of colour moving up.',
      anchor: addLayer('bars'), done: (c) => !!bars(c) },
    { id: 'high', page: '/studio', title: 'Its colours',
      text: 'Click {param:bars.colours} and tick high: the palette\'s brightest colours '
        + 'stand out against the deep bed.',
      anchor: ['param:colours'], done: (c) => {
        const t = tokens(param(c, 'bars', 'bars', 'colours'));
        return t.includes('high') && !t.includes('all');
      } },
    { id: 'spires', page: '/studio', title: 'Where it plays',
      text: 'A layer lights only the groups it plays on, found by the rig\'s tags. Open Plays on, untick the whole '
        + 'building, then tick the spires: bars rising up them read at once.',
      anchor: (c) => ['plays-on', ...(c.v?.tagged('spire').slice(0, 1) ?? []).map((g) => `group:${g}`)],
      done: (c) => {
        const g = bars(c)?.groups, spire = c.v?.tagged('spire') ?? [];
        return !!g?.length && g.every((x) => spire.includes(x));
      } },
    { id: 'view', page: '/studio', title: 'A camera view',
      text: 'The views jump the camera to parts of the Folly, so you can watch the part you are building. Click '
        + 'Spire.',
      anchor: ['view-bar', 'view:spire'], done: ({ v }) => v?.view.value === 'spire' },
    { id: 'zoom', page: '/studio', title: 'Zoom in',
      text: 'Scroll on the preview to zoom in on the bars. Double-click it later to frame the whole Folly again.',
      anchor: ['preview'], begin: ({ v }) => v?.view.peek(),
      done: ({ v }, was) => !!v && v.view.value === null && was !== null },
    { id: 'solo', page: '/studio', title: 'Solo',
      text: 'Solo plays only that layer, so you can shape it without the rest. Click S on {module:bars}.',
      anchor: ['solo:bars'], done: (c) => !!bars(c)?.solo },
    { id: 'comet', page: '/studio', title: 'A choice',
      text: 'Set {param:bars.profile} to Comet: each bar becomes a bright head with a fading tail, like light '
        + 'shooting up.',
      anchor: ['param:profile'], done: (c) => param(c, 'bars', 'bars', 'profile') === 'comet' },
    { id: 'warp', page: '/studio', title: 'A warp',
      text: 'A chain runs top to bottom: the source draws first, then each module changes what the ones above it '
        + 'made. A warp moves the light around without changing its colour. Click + Module, then Warps, then '
        + '{module:twist}.',
      anchor: addModule('warp', 'twist'), done: (c) => has(c, 'twist') },
    { id: 'wind', page: '/studio', title: 'A warp\'s setting',
      text: 'Drag {param:twist.wind} to 0.50 or more: it winds the bars round each spire, so they spiral up.',
      anchor: ['module:twist', 'param:wind'], done: (c) => (num(param(c, 'bars', 'twist', 'wind')) ?? 0) >= 0.5,
      progress: (c) => ({ now: num(param(c, 'bars', 'twist', 'wind')) ?? 0, goal: 0.5 }) },
    { id: 'filter', page: '/studio', title: 'A filter',
      text: 'A filter, after the warps, reworks the light itself: its colour, brightness or timing. Click + Module, '
        + 'then Filters, then {module:trails}, which leaves a glow behind each bar. So: the source draws, warps '
        + 'move, filters rework.',
      anchor: addModule('filter', 'trails'), done: (c) => has(c, 'trails') },
    { id: 'switch', page: '/studio', title: 'On and off',
      text: 'A module\'s switch skips it and keeps its settings. Turn {module:twist} off, then on again, to compare '
        + 'the bars with and without their spiral.',
      anchor: ['module-on:twist'], ...twice((c) => twist(c)?.enabled === false, (c) => twist(c)?.enabled === true) },
    { id: 'soften', page: '/studio', title: 'Soften',
      text: 'Soften blurs a layer at the end of its chain. Set it to 40 cm or more, so the bars\' edges melt into '
        + 'the stone.',
      anchor: ['soften'], done: (c) => (bars(c)?.soften ?? 0) >= 0.4,
      progress: (c) => ({ now: bars(c)?.soften ?? 0, goal: 0.4 }) },
    { id: 'unsolo', page: '/studio', title: 'Solo off',
      text: 'Click S on {module:bars} again, back to the whole look, to see the bars on the bed.',
      anchor: ['solo:bars'], done: (c) => !!bars(c) && !bars(c)!.solo },
    { id: 'level', page: '/studio', title: 'Level',
      text: 'Level sets how strongly a layer shows. Set the bars\' to 70 % or less, so they sit in the bed instead '
        + 'of glaring over it.',
      anchor: ['level:bars'], done: (c) => (bars(c)?.level ?? 1) <= 0.7,
      progress: (c) => ({ now: 1 - (bars(c)?.level ?? 1), goal: 0.3 }) },
    { id: 'blend', page: '/studio', title: 'Blend',
      text: 'Blend is how a layer meets the ones below. Pick Over: the bars keep their own colour instead of '
        + 'mixing with the blue.',
      anchor: ['blend:bars'], done: (c) => bars(c)?.blend === 'over' },
    { id: 'sparkle', page: '/studio', title: 'A third layer',
      text: 'Another source on its own layer: click + Add, then Blank, then {module:sparkle}. Single LEDs glint, each '
        + 'at its own time.',
      anchor: addLayer('sparkle'), done: (c) => !!layerBy(c, 'sparkle') },
    { id: 'order', page: '/studio', title: 'Order',
      text: 'Order decides what covers what. Click ↓ to move {module:sparkle} under the bars: the glints hide as '
        + 'each bar passes and come back behind it.',
      anchor: ['move-layer-down'], done: (c) => index(c, 'sparkle') >= 0 && index(c, 'sparkle') < index(c, 'bars'),
      next: true },
  ],
};
