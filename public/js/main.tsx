// Folly Studio: the app shell (ui/app.tsx) replaces the boot message, then the session decides the first view.
import { render } from 'preact';

import { App, boot } from './ui/app.tsx';

const root = document.getElementById('app') as HTMLElement;
root.replaceChildren();
render(<App />, root);
boot();
