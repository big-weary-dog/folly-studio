// A guest's work (SPEC-access "Guests"): the Studio's look as saved, kept in this browser as it changes and opened
// again on a blank Studio; Save asks them to sign in, and the first account to open a blank Studio here takes it.
import { effect } from '@preact/signals';

import { api } from '../api.ts';
import type { Look } from '../../../shared/schemas/api.ts';
import { confirmDialog, toast } from './kit.tsx';
import { navigate, user } from './session.ts';
import type { Studio } from './studio-store.ts';

const KEY = 'folly-guest-work';

/** The work kept here, as a look to open (never one of the server's: no id), or null. */
export function guestWork(): Look | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!kept || typeof kept !== 'object' || !Array.isArray(kept.layers)) return null;
    if (!user.peek()?.guest) localStorage.removeItem(KEY);   // an account takes it, unsaved
    return { ...kept, id: '', owner: user.peek()?.id } as Look;
  } catch { return null; }
}

const write = (st: Pick<Studio, 'body'>) => {
  try { localStorage.setItem(KEY, JSON.stringify(st.body.peek())); } catch { /* storage off: kept for this visit */ }
};

/** Keeps a guest's edits here, half a second after each: the returned function stops (and writes what is due). */
export function keepGuestWork(st: Pick<Studio, 'body' | 'dirty'>) {
  let due = 0;
  const flush = () => { if (due) { clearTimeout(due); due = 0; write(st); } };
  const stop = effect(() => {
    void st.body.value;
    if (!st.dirty.value) return;
    clearTimeout(due);
    due = window.setTimeout(() => { due = 0; write(st); }, 500);
  });
  addEventListener('pagehide', flush);
  return () => { stop(); flush(); removeEventListener('pagehide', flush); };
}

/** Save, for a guest: saving is for accounts, so offer to sign in, the work coming along. */
export async function guestSave(st: Pick<Studio, 'body'>) {
  const go = await confirmDialog('Saving is for accounts. Log in or sign up and this look comes with you to save; '
    + 'until then it stays in this browser.', { title: 'Log in to save', ok: 'Log in or sign up' });
  if (!go) return false;
  write(st);
  try { await api.logout(); } catch (err) { toast((err as Error).message, { kind: 'error' }); return false; }
  user.value = null;
  await navigate('/login?mode=signup&next=/studio', { force: true, replace: true });
  return false;
}
