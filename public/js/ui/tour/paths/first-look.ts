// First look, the first chapter of Spire rise and the one path that opens by itself: a module's value, the preview.
import { type Ctx, num, param, type Path } from '../types.ts';

const speed = (c: Ctx) => num(param(c, 'colour-wash', 'colour-wash', 'speed'));

export const firstLook: Path = {
  id: 'first-look', title: 'First look', start: '/studio?tour=first-look',
  about: 'Start Spire rise: a module, its settings and the preview.',
  steps: [
    { id: 'report', title: 'Still being built',
      text: 'Studio is in development, so things will break. When they do, your name › Report a problem '
        + '(or F8) tells us.',
      anchor: ['user-menu', 'report'], done: () => true, next: true },
    { id: 'speed', page: '/studio', title: 'A module\'s settings',
      text: 'Spire rise starts here: a calm bed, bars climbing the spires, sparkles on top. {module:colour-wash} is a '
        + 'source, a module that draws light. Set its {param:colour-wash.speed} to 0.05 or less, so the colours drift.',
      anchor: ['param:speed'], done: (c) => (speed(c) ?? 1) <= 0.05,
      progress: (c) => ({ now: 0.2 - Math.min(0.2, speed(c) ?? 0.2), goal: 0.15 }) },
    { id: 'turn', page: '/studio', title: 'Turn the model',
      text: 'The preview is the real rig, every LED where it hangs. Drag it to turn the Folly and see the bed from '
        + 'another side.',
      anchor: ['preview'], begin: ({ v }) => v?.view.peek(), done: ({ v }, was) => !!v && v.view.value !== was,
      next: true },
  ],
};
