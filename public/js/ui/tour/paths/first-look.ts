// Getting around, the first chapter of Rose and arches and the one path that opens by itself: the preview, the
// camera, play, and the way to Ideas.
import { type Path, twice } from '../types.ts';

export const firstLook: Path = {
  id: 'first-look', title: 'Getting around', start: '/studio?tour=first-look',
  about: 'The preview, the camera, play, and the pages.',
  steps: [
    { id: 'turn', page: '/studio', title: 'Turn the model',
      text: 'The preview is the real rig, every LED where it hangs. Drag it to see the Folly from another side.',
      anchor: ['preview'], begin: ({ v }) => v?.view.peek(), done: ({ v }, was) => !!v && v.view.value !== was },
    { id: 'rose', page: '/studio', title: 'A view',
      text: 'The views put the camera on one part of the Folly in a click. Click Rose: the rose window is where our '
        + 'look will start.',
      anchor: ['view-bar', 'view:rose'], done: ({ v }) => v?.view.value === 'rose' },
    { id: 'zoom', page: '/studio', title: 'Zoom',
      text: 'Scroll on the preview to move in close to the rose window\'s rings.',
      anchor: ['preview'], done: ({ v }) => !!v && v.view.value === null },
    { id: 'fit', page: '/studio', title: 'The whole Folly',
      text: 'Fit frames the whole Folly again (so does a double-click on the preview). Click Fit.',
      anchor: ['view-bar', 'view:fit'], done: ({ v }) => v?.view.value === 'fit' },
    { id: 'pause', page: '/studio', title: 'Pause and play',
      text: 'Pause freezes a moment to study. Click ▶ (or press Space) to pause, then again to play.',
      anchor: ['play'], ...twice(({ v }) => v?.playing.value === false, ({ v }) => v?.playing.value === true) },
    { id: 'ideas', title: 'Ideas',
      text: 'A look usually starts as a sentence about what you want to see. Click Ideas.',
      anchor: ['nav:ideas'], done: ({ page }) => page.startsWith('/ideas'), next: true },
  ],
};
