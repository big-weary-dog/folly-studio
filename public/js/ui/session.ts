// What views share with the shell (app.tsx): who is signed in, navigation, the title, and the guard on unsaved
// Studio edits. The shell plugs its router in, so no view imports the shell (an import cycle would cost Vite's HMR).
import { signal } from '@preact/signals';

import type { User } from '../types.ts';

export interface ViewProps { params: Record<string, string>; query: URLSearchParams; scope?: 'mine' | 'gallery' }
export const user = signal<User | null>(null);
/** The Studio's unsaved edits: whether there are any, and how to drop them. */
export const leaveGuard: { isDirty?: () => boolean; discard?: () => void } = {};
type Go = { replace?: boolean; force?: boolean };
/** The shell's router (its go() set by app.tsx), and the address it shows. */
export const router: { go: (to: string, o: Go) => Promise<void>; shown: string } = { go: async () => {}, shown: '' };
export const here = () => location.pathname + location.search;

export const navigate = (to: string, o: Go = {}) => router.go(to, o);
export const setTitle = (t?: string) => { document.title = t ? `${t} · Folly Studio` : 'Folly Studio'; };
/** Change the address bar without leaving the view (a new look got its id). */
export function replaceUrl(path: string) { history.replaceState(null, '', path); router.shown = here(); }

/** An API call said 401: back to the login screen. */
export function signedOut() {
  user.value = null;
  navigate(`/login?next=${encodeURIComponent(here())}`, { replace: true, force: true });
}
