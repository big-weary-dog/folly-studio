// First look: the one path that opens by itself. A blank Studio, a preset, the view, a module, a value, mute.
import { tourName } from '../../tour-view.ts';
import { type Ctx, num, type Path } from '../types.ts';

/** The look's first layer, the one a new look starts with: one module from the library's first source. */
const washOf = ({ v }: Ctx) => v?.layers.value
  .find((l) => l.modules.length === 1 && l.modules[0].ref === 'colour-wash');

export const firstLook: Path = {
  id: 'first-look', title: 'First look', start: '/studio',
  about: 'A preset, the 3D view, a module and its settings.',
  steps: [
    { id: 'report', title: 'Still being built',
      text: 'Studio is in development, so things will break. When they do, your name › Report a problem '
        + '(or F8) tells us.',
      anchor: ['user-menu', 'report'], done: () => true, next: true },
    { id: 'studio', title: 'The Studio', text: 'Open the Studio.',
      anchor: ['nav:studio'], done: ({ v, page }) => page.startsWith('/studio') && !!v?.ready.value },
    { id: 'preset', page: '/studio', title: 'Add a preset',
      text: 'Click + Add, then Presets, then {preset:starfield}.',
      anchor: ['layers-add', 'shelf-tab:preset', 'shelf:starfield'],
      begin: ({ v }) => v?.layers.peek().length ?? 0,
      done: ({ v }, n) => (v?.layers.value.length ?? 0) > (n as number) },
    { id: 'view', page: '/studio', title: 'Look around',
      text: 'Click Rose, or drag the model to turn it.', anchor: ['view-bar', 'view:rose'],
      begin: ({ v }) => v?.view.peek(), done: ({ v }, was) => !!v && v.view.value !== was },
    { id: 'module', page: '/studio', title: 'Open a module',
      text: 'A preset is a chain of modules. Click {module:sparkle}.',
      anchor: ['layer:starfield', 'module:sparkle'], done: ({ v }) => v?.module.value?.ref === 'sparkle' },
    { id: 'value', page: '/studio', title: 'Change a value',
      text: 'Drag {param:sparkle.density} past 0.80.', anchor: ['param:density'],
      done: ({ v }) => v?.module.value?.ref === 'sparkle' && (num(v.params.value.density) ?? 0) >= 0.8,
      progress: ({ v }) => (v?.module.value?.ref === 'sparkle'
        ? { now: num(v.params.value.density) ?? 0, goal: 0.8 } : null) },
    { id: 'mute', page: '/studio', title: 'Mute, then keep it',
      text: 'M mutes a layer. Mute {module:colour-wash}. Save keeps the look.',
      anchor: (c) => { const l = washOf(c); return l ? [`mute:${tourName(l.title)}`] : ['layers']; },
      done: (c) => !!washOf(c)?.muted, next: true },
  ],
};
