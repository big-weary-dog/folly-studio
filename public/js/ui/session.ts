// What views share with the shell (app.tsx): who is signed in, navigation, the title, and the guard on unsaved
// Studio edits. The shell plugs its router in, so no view imports the shell (an import cycle would cost Vite's HMR).
import { signal } from '@preact/signals';

import { onSignedOut } from '../api.ts';
import type { FlashSettings, User } from '../../../shared/schemas/api.ts';

export interface ViewProps { params: Record<string, string>; query: URLSearchParams; scope?: 'mine' | 'gallery' }
export const user = signal<User | null>(null);
/** The server's flash check: whether it runs, and its limits (GET /api/me's `flash`); null until known. */
export const flash = signal<FlashSettings | null>(null);
/** The server's profile (SPEC-offline): 'pi' has no generators, so no Ideas, Refine or AI fixes. */
export const profile = signal<'hosted' | 'pi'>('hosted');
export const onPi = () => profile.value === 'pi';
/** Where a signed-in visitor starts: Ideas, or My looks on the Pi. */
export const home = () => (onPi() ? '/looks' : '/ideas');
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

/** The session ended (an API call said 401, api.ts): back to the login screen, once for calls that end together. */
export function signedOut() {
  if (!user.value) return;
  user.value = null;
  for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
  navigate(`/login?next=${encodeURIComponent(here())}`, { replace: true, force: true });
}
onSignedOut(signedOut);
