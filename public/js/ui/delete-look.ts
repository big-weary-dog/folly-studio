// Deleting a look, after a confirm: its owner's own, or, for an admin, anyone's shared look (SPEC-access).
import { api } from '../api.ts';
import { can } from '../../../shared/policy.ts';
import { confirmDialog, toast } from './kit.tsx';
import { user } from './session.ts';

type Gone = { id: string; title: string; owner: string; ownerName?: string; shared?: boolean };
type Me = Parameters<typeof can>[0];

/** Whether `me` gets a Delete on `look`: on My looks, the owner; on the gallery (its cards, the Studio's notice), an
 * admin only, so nobody deletes their own shared look by a stray tap there. */
export const mayDelete = (me: Me, look: Gone, gallery: boolean) =>
  can(me, 'delete', look) && (!gallery || can(me, 'admin'));

/** Asks, naming the look (and its owner when it is someone else's), then deletes it; whether it went. */
export async function deleteLook(look: Gone): Promise<boolean> {
  const theirs = look.owner !== user.value?.id ? ` by ${look.ownerName || 'someone else'}` : '';
  const ok = await confirmDialog(`Delete “${look.title || 'Untitled look'}”${theirs}? This cannot be undone.`,
    { title: 'Delete look', ok: 'Delete', danger: true });
  if (!ok) return false;
  try {
    await api.deleteLook(look.id);
    toast('Look deleted.');
    return true;
  } catch (err) {
    toast((err as Error).message, { kind: 'error' });
    return false;
  }
}
