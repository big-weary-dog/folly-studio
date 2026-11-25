// What views share with the shell (app.tsx): who is signed in, navigation, the title, and the guard on unsaved
// edits. The shell plugs its router in, so no view imports the shell (an import cycle would cost Vite's HMR).
import { computed, signal } from '@preact/signals';

import { onSignedOut } from '../api.ts';
import type { FlashSettings, User } from '../../../shared/schemas/api.ts';
import type { RigName } from '../../../shared/schemas/rig.ts';

export interface ViewProps { params: Record<string, string>; query: URLSearchParams; scope?: 'mine' | 'gallery' }
export const user = signal<User | null>(null);
/** The server's flash check: whether it runs, and its limits (GET /api/me's `flash`); null until known. */
export const flash = signal<FlashSettings | null>(null);
/** The rig the server shows, bakes and boxes (SPEC "Rig", GET /api/me's `rig`): the views load the same one. */
export const rig = signal<RigName>('folly');
/** The Studio's Advanced editing on a laptop (spec/studio "Simple"), as this browser chose it; null: not chosen. */
const ADVANCED = 'studio.advanced';
const chosen = signal<boolean | null>((() => {
  try { return { 1: true, 0: false }[localStorage.getItem(ADVANCED) ?? ''] ?? null; } catch { return null; }
})());
/** Whether the Studio shows Advanced editing: as chosen, else on for an account and off for a guest or visitor. */
export const advanced = computed(() => chosen.value ?? !!(user.value && !user.value.guest));
export function setAdvanced(on: boolean) {
  chosen.value = on;
  try { localStorage.setItem(ADVANCED, on ? '1' : '0'); } catch { /* private mode: kept for this visit */ }
}
/** Where a signed-in visitor starts: the gallery (spec/http "Moderation"). */
export const HOME = '/gallery';
type Me = { user: User | null, flash?: FlashSettings | null, rig?: RigName };
/** Who the server says is signed in (GET /api/me, or a sign-in's answer), and what follows from it. */
export function signedIn(me: Partial<Me>) {
  rig.value = me.rig ?? 'folly';
  if (me.flash !== undefined) flash.value = me.flash ?? null;
  user.value = me.user ?? null;
}
/** The active page's unsaved edits: whether there are any, and how to drop them. */
export const leaveGuard: { isDirty?: () => boolean; discard?: () => void } = {};
type Go = { replace?: boolean; force?: boolean };
/** The shell's router (its go() set by app.tsx), and the address it shows. */
export const router: { go: (to: string, o: Go) => Promise<void>; shown: string } = { go: async () => {}, shown: '' };
export const here = () => location.pathname + location.search;

export const navigate = (to: string, o: Go = {}) => router.go(to, o);
export const setTitle = (t?: string) => { document.title = t ? `${t} · Folly Studio` : 'Folly Studio'; };
/** Change the address bar without leaving the view (a new look got its id). */
export function replaceUrl(path: string) { history.replaceState(null, '', path); router.shown = here(); }

/** The session ended, or a visitor asked for more than approved looks (an API call said 401, api.ts): to the login
 * screen, once for calls that end together. */
export function signedOut() {
  if (location.pathname.startsWith('/login')) return;
  user.value = null;
  for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
  navigate(`/login?next=${encodeURIComponent(here())}`, { replace: true, force: true });
}
onSignedOut(signedOut);
