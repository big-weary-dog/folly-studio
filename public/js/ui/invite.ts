// Invite links (SPEC-access): /#invite=CODE. The code rides in the fragment, so it never reaches a server log or a
// Referer; it waits in sessionStorage across signing up or in, and is redeemed once, then forgotten.
import { api } from '../api.ts';
import { toast } from './kit.tsx';
import { signedIn, user } from './session.ts';

const KEY = 'folly-invite';
const store = (code?: string) => {
  try { return code ? sessionStorage.setItem(KEY, code) : sessionStorage.removeItem(KEY); } catch { /* private */ }
};

/** Take the code out of the address (before the router rewrites it) into this tab's sessionStorage. */
export function takeInvite() {
  const code = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (!code) return;
  store(code.trim());
  history.replaceState(history.state, '', location.pathname + location.search);
}

export function pendingInvite() {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

/** Redeem the waiting code, if any (an account is signed in: a guest's waits), and say how it went. */
export async function redeemInvite() {
  const code = pendingInvite();
  if (!code || user.peek()?.guest) return;
  store();
  await redeem(code);
}

/** Redeem `code`, say how it went, and show the AI once it is unlocked: whether it was. */
export async function redeem(code: string) {
  try {
    await api.redeem(code);
    signedIn(await api.me());
    const paid = (await api.models().catch(() => null))?.models.filter((m) => m.paid).map((m) => m.label) ?? [];
    toast(`Invite accepted${paid.length ? `: you can use ${new Intl.ListFormat('en').format(paid)}` : ''}.`,
      { kind: 'ok', timeout: 9000 });
    return true;
  } catch (err) {
    toast(`Invite not accepted. ${(err as Error).message}`, { kind: 'error', timeout: 0 });
    return false;
  }
}
