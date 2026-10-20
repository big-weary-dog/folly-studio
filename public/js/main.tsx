// Folly Studio: the app shell (ui/app.tsx) replaces the boot message, then the session decides the first view.
import { render } from 'preact';

import { App, boot } from './ui/app.tsx';
import { loadFailed } from './ui/kit.tsx';

const root = document.getElementById('app') as HTMLElement;
root.replaceChildren();
render(<App />, root);
boot();
// A lazy chunk's files are gone after a deploy: say so rather than fail silently (the import rejects too).
addEventListener('vite:preloadError', (e) => loadFailed((e as Event & { payload?: unknown }).payload));
