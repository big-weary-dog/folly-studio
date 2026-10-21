// Layers and chains, Rose and arches' fourth chapter: solo, a chain of source, warp and filter on each of the two
// layers, where a layer plays, then a preset's layer and how it meets the others: level, blend, order, mute.
import { type Ctx, layerBy, num, on, param, type Path, twice } from '../types.ts';

const rose = (c: Ctx) => layerBy(c, 'rose'), arches = (c: Ctx) => layerBy(c, 'arches');
const star = (c: Ctx) => layerBy(c, 'starfield');
const glass = (c: Ctx) => rose(c)?.modules.find((m) => m.ref === 'stained-glass') ?? null;
const index = (c: Ctx, slug: string) => c.v?.layers.value.findIndex((l) => l.id === layerBy(c, slug)?.id) ?? -1;
/** + Module › `tab` › `name` on layer `slug`. */
const addModule = (slug: string, tab: string, name: string) => on(slug, null, 'chain-add', `shelf-tab:${tab}`,
  `shelf:${name}`);
const angle = (c: Ctx) => num(param(c, 'arches', 'rotate', 'angle')) ?? 0;
const mini = (c: Ctx) => c.v?.tagged('arch-mini') ?? [];

export const layers: Path = {
  id: 'layers', title: 'Layers and chains', start: '/studio?tour=layers',
  about: 'Solo, warps and filters, where a layer plays, a preset, level, blend and order.',
  steps: [
    { id: 'solo', page: '/studio', title: 'Solo',
      text: 'Solo plays only that layer, so you can shape it without the rest. Click S on Rose.',
      anchor: ['solo:rose'], done: (c) => !!rose(c)?.solo },
    { id: 'filter', page: '/studio', title: 'A filter',
      text: 'A layer\'s chain runs top to bottom: the source draws, then each module reworks what the ones above '
        + 'made. A filter changes the light itself. On Rose, click + Module, Filters, then {module:stained-glass}: '
        + 'the rose\'s panes glow like a cathedral window.',
      anchor: addModule('rose', 'filter', 'stained-glass'), done: (c) => !!glass(c) },
    { id: 'rule', page: '/studio', title: 'A filter\'s choice',
      text: 'Set {param:stained-glass.rule} to Spiral: the panes\' colours wind out from the heart of the rose.',
      anchor: on('rose', 'stained-glass', 'param:rule'),
      done: (c) => param(c, 'rose', 'stained-glass', 'rule') === 'spiral' },
    { id: 'switch', page: '/studio', title: 'On and off',
      text: 'A module\'s switch skips it and keeps its settings. Turn {module:stained-glass} off, then on again, to '
        + 'compare the rose with and without its glass.',
      anchor: on('rose', null, 'module-on:stained-glass'),
      ...twice((c) => glass(c)?.enabled === false, (c) => glass(c)?.enabled === true) },
    { id: 'swap', page: '/studio', title: 'Solo another',
      text: 'The next changes are on the arches. Click S on Rose to let it go, then S on Arches.',
      anchor: (c) => (rose(c)?.solo ? ['solo:rose'] : ['solo:arches']),
      done: (c) => !!rose(c) && !rose(c)!.solo && !!arches(c)?.solo },
    { id: 'warp', page: '/studio', title: 'A warp',
      text: 'A warp moves the light without changing its colour, between the source and the filters. On Arches, '
        + 'click + Module, Warps, then {module:rotate}.',
      anchor: addModule('arches', 'warp', 'rotate'),
      done: (c) => !!arches(c)?.modules.some((m) => m.ref === 'rotate') },
    { id: 'angle', page: '/studio', title: 'A warp\'s number',
      text: 'Set {param:rotate.angle} to 0.25 or more: at a quarter turn the comets sweep across the arches instead '
        + 'of up them.',
      anchor: on('arches', 'rotate', 'param:angle'), done: (c) => angle(c) >= 0.25,
      progress: (c) => ({ now: Math.max(0, angle(c) - 0.125), goal: 0.125 }) },
    { id: 'soften', page: '/studio', title: 'Soften',
      text: 'Soften blurs a layer at the end of its chain. Set it to 40 cm or more, so the comets\' heads melt into a '
        + 'glow.',
      anchor: on('arches', null, 'soften'), done: (c) => (arches(c)?.soften ?? 0) >= 0.4,
      progress: (c) => ({ now: arches(c)?.soften ?? 0, goal: 0.4 }) },
    { id: 'plays', page: '/studio', title: 'Where it plays',
      text: 'A layer lights only the groups it plays on. Open Plays on and tick the small arches as well: the '
        + 'comets run on them too.',
      anchor: (c) => on('arches', null, 'plays-on', ...mini(c).slice(0, 1).map((g) => `group:${g}`))(c),
      done: (c) => !!arches(c)?.groups?.some((g) => mini(c).includes(g)) },
    { id: 'unsolo', page: '/studio', title: 'Solo off',
      text: 'Click S on Arches again, back to the whole look.',
      anchor: ['solo:arches'], done: (c) => !!arches(c) && !arches(c)!.solo },
    { id: 'preset', page: '/studio', title: 'A preset',
      text: 'A preset is a layer ready-made from modules. Click + Add, Presets, then {preset:starfield}: stars glint '
        + 'over a dark sky on the whole Folly.',
      anchor: ['layers-add', 'shelf-tab:preset', 'shelf:starfield'], done: (c) => !!star(c) },
    { id: 'inside', page: '/studio', title: 'Inside a preset',
      text: 'A preset\'s layer is a chain like any other, to tune. Open its {module:sparkle} and set '
        + '{param:sparkle.density} to 0.9 or more, for a sky full of stars.',
      anchor: on('starfield', 'sparkle', 'param:density'),
      done: (c) => (num(param(c, 'starfield', 'sparkle', 'density')) ?? 0) >= 0.9,
      progress: (c) => ({ now: Math.max(0, (num(param(c, 'starfield', 'sparkle', 'density')) ?? 0.5) - 0.5),
        goal: 0.4 }) },
    { id: 'level', page: '/studio', title: 'Level',
      text: 'Level is how strongly a layer shows. Set the Starfield\'s to 50 % or less, so it is a bed for the rose '
        + 'and the arches.',
      anchor: ['level:starfield'], done: (c) => (star(c)?.level ?? 1) <= 0.5,
      progress: (c) => ({ now: 1 - Math.max(0.5, star(c)?.level ?? 1), goal: 0.5 }) },
    { id: 'blend', page: '/studio', title: 'Blend',
      text: 'Blend is how a layer meets the ones below. Pick Over: the Starfield covers them instead of adding to '
        + 'them, so the arches fade under it.',
      anchor: ['blend:starfield'], done: (c) => star(c)?.blend === 'over' },
    { id: 'order', page: '/studio', title: 'Order',
      text: 'What is lower is covered. Click ↓ to move the Starfield to the bottom: the rose and the arches are back, '
        + 'over the stars.',
      anchor: on('starfield', null, 'move-layer-down'), done: (c) => index(c, 'starfield') === 0 },
    { id: 'mute', page: '/studio', title: 'Mute',
      text: 'Mute silences a layer without removing it. Click M on the Starfield to see the look without it, then '
        + 'again to bring it back.',
      anchor: ['mute:starfield'], ...twice((c) => !!star(c)?.muted, (c) => !!star(c) && !star(c)!.muted),
      next: true },
  ],
};
