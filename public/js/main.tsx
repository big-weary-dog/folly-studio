// Folly Studio: the app shell (ui/app.tsx) replaces the boot message, then the session decides the first view.
import { render } from 'preact';

import { App, boot } from './ui/app.tsx';
import { installBugReport } from './ui/bug-report.tsx';
import { loadFailed } from './ui/kit.tsx';
import { watchBuild } from './ui/updates.ts';

installBugReport();
const root = document.getElementById('app') as HTMLElement;
root.replaceChildren();
render(<App />, root);
boot();
// A lazy chunk's files are gone after a deploy: reload onto it, or say so, rather than fail silently (the import
// rejects too); a deploy is noticed without one too.
addEventListener('vite:preloadError', (e) => loadFailed((e as Event & { payload?: unknown }).payload));
watchBuild(() => void loadFailed());
