// Layers and chains, Rose and arches' fourth chapter: solo, a filter and a warp on the rose's chain, the chain folded
// and reordered, where a layer plays, then a preset's layer and how it meets the others: level, blend, order, mute.
import { type Ctx, layerBy, num, on, param, type Path, twice } from '../types.ts';

const rose = (c: Ctx) => layerBy(c, 'rose'), arches = (c: Ctx) => layerBy(c, 'arches');
const star = (c: Ctx) => layerBy(c, 'starfield');
const shift = (c: Ctx) => rose(c)?.modules.find((m) => m.ref === 'hue-shift') ?? null;
const index = (c: Ctx, slug: string) => c.v?.layers.value.findIndex((l) => l.id === layerBy(c, slug)?.id) ?? -1;
/** + Module › `tab` › `name` on layer `slug`. */
const addModule = (slug: string, tab: string, name: string) => on(slug, null, 'chain-add', `shelf-tab:${tab}`,
  `shelf:${name}`);
const offset = (c: Ctx) => Math.abs(num(param(c, 'rose', 'hue-shift', 'offset')) ?? 0);
const spin = (c: Ctx) => Math.abs(num(param(c, 'rose', 'rotate', 'spin')) ?? 0);
const mini = (c: Ctx) => c.v?.tagged('arch-mini') ?? [];
const pos = (c: Ctx, ref: string) => rose(c)?.modules.findIndex((m) => m.ref === ref) ?? -1;

export const layers: Path = {
  id: 'layers', title: 'Layers and chains', start: '/studio?tour=layers',
  about: 'Solo, filters and warps, where a layer plays, a preset, level, blend and order.',
  steps: [
    { id: 'solo', page: '/studio', title: 'Solo',
      text: 'Solo plays only that layer, so you can shape it without the rest. Click S on Rose.',
      anchor: ['solo:rose'], done: (c) => !!rose(c)?.solo },
    { id: 'filter', page: '/studio', title: 'A filter',
      text: 'A layer\'s chain runs top to bottom: the source draws, then each module reworks what the ones above '
        + 'made. A filter changes the light itself. On Rose, click + Module, Filters, then {module:hue-shift}: the '
        + 'rose\'s colours start to roll round the colour wheel.',
      anchor: addModule('rose', 'filter', 'hue-shift'), done: (c) => !!shift(c) },
    { id: 'offset', page: '/studio', title: 'A filter\'s number',
      text: 'Set {param:hue-shift.offset} to 0.5: each colour turns to its opposite on the colour wheel, and the '
        + 'texture of the rose shows in new colours.',
      anchor: on('rose', 'hue-shift', 'param:offset'), done: (c) => offset(c) >= 0.45,
      progress: (c) => ({ now: Math.min(0.45, offset(c)), goal: 0.45 }) },
    { id: 'switch', page: '/studio', title: 'On and off',
      text: 'A module\'s switch skips it and keeps its settings. Turn {module:hue-shift} off, then on again, to '
        + 'compare the rose with and without it.',
      anchor: on('rose', null, 'module-on:hue-shift'),
      ...twice((c) => shift(c)?.enabled === false, (c) => shift(c)?.enabled === true) },
    { id: 'warp', page: '/studio', title: 'A warp',
      text: 'A warp moves the light without changing its colour, between the source and the filters. On Rose, '
        + 'click + Module, Warps, then {module:rotate}.',
      anchor: addModule('rose', 'warp', 'rotate'),
      done: (c) => !!rose(c)?.modules.some((m) => m.ref === 'rotate') },
    { id: 'spin', page: '/studio', title: 'A warp\'s speed',
      text: 'Set {param:rotate.spin} to 0.1 or more: the rose window turns slowly round its heart, a turn every few '
        + 'seconds.',
      anchor: on('rose', 'rotate', 'param:spin'), done: (c) => spin(c) >= 0.1,
      progress: (c) => ({ now: Math.min(0.1, spin(c)), goal: 0.1 }) },
    { id: 'fold', page: '/studio', title: 'The whole chain',
      text: 'A module\'s settings open under its line. Click {module:rotate} to fold them away: the chain shows a '
        + 'module a line, top to bottom.',
      anchor: on('rose', null, 'module:rotate'), area: 'chain',
      done: (c) => pos(c, 'rotate') >= 0 && c.el('module:rotate')?.getAttribute('aria-expanded') === 'false' },
    { id: 'drag', page: '/studio', title: 'Reorder the chain',
      text: 'A module reworks only what is above it. Drag {module:rotate} by the dots at its left down below '
        + '{module:turbulence}: it turns the ripples too, so the whole rose wheels round as one.',
      anchor: on('rose', null, 'module-grip:rotate'), area: 'chain',
      done: (c) => pos(c, 'turbulence') >= 0 && pos(c, 'rotate') > pos(c, 'turbulence') },
    { id: 'swap', page: '/studio', title: 'Solo another',
      text: 'The next change is on the arches. Click S on Rose to let it go, then S on Arches.',
      anchor: (c) => (rose(c)?.solo ? ['solo:rose'] : ['solo:arches']),
      done: (c) => !!rose(c) && !rose(c)!.solo && !!arches(c)?.solo },
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
      text: 'What is lower is covered. Drag the Starfield by the dots at its left to the bottom: the rose and the '
        + 'arches are back, over the stars.',
      anchor: ['layer-grip:starfield'], area: 'layers', done: (c) => index(c, 'starfield') === 0 },
    { id: 'mute', page: '/studio', title: 'Mute',
      text: 'Mute silences a layer without removing it. Click M on the Starfield to see the look without it, then '
        + 'again to bring it back.',
      anchor: ['mute:starfield'], ...twice((c) => !!star(c)?.muted, (c) => !!star(c) && !star(c)!.muted),
      next: true },
  ],
};
